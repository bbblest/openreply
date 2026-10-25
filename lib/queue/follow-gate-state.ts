import { createHash } from "node:crypto";
import { getRedisConnection } from "./client";

export const FOLLOW_CHECK_LEASE_MS = 45_000;
const STATE_TTL_MS = 24 * 60 * 60_000;
export type FollowGateAction = "begin" | "current" | "complete" | "release" | "cancel" | "expire";
export type FollowGateState = {
  state: "prompted" | "checking" | "followed" | "cooldown";
  currentCheckId: string;
  checkStartedAt: number;
  deadline: number;
  lastEventAt: number;
  attemptCount: number;
  attemptWindowStart: number;
  failures: number[];
  unknownCount: number;
  cooldownUntil: number;
  lastNextStepSentAt: number;
  settling: boolean;
};

// Compare-and-set runs atomically in Redis; transitions below never overwrite a
// state changed by another worker. Only the matching version can win the lease.
export const FOLLOW_GATE_CAS = `
if (redis.call('GET', KEYS[1]) or '') ~= ARGV[1] then return 0 end
redis.call('SET', KEYS[1], ARGV[2], 'PX', ARGV[3])
return 1
`;

export function initialFollowGateState(): FollowGateState {
  return { state: "prompted", currentCheckId: "", checkStartedAt: 0, deadline: 0,
    lastEventAt: 0, attemptCount: 0, attemptWindowStart: 0, failures: [], unknownCount: 0,
    cooldownUntil: 0, lastNextStepSentAt: 0, settling: false };
}

/** Pure transition, persisted only if the Redis version still matches. */
export function nextFollowGateState(
  previous: FollowGateState, action: FollowGateAction, id: string, now: number, value: string | number,
): { state: FollowGateState; result: string } {
  const s = { ...previous, failures: [...previous.failures] };
  const result = (result: string) => ({ state: s, result });
  function complete(status: string | number): string {
    if (status === "true") {
      s.state = "followed"; s.failures = []; s.attemptCount = 0; s.attemptWindowStart = 0;
      s.unknownCount = 0; s.cooldownUntil = 0;
      return "following";
    }
    s.state = "prompted";
    if (status !== "false") { s.unknownCount++; return "unknown"; }
    s.unknownCount = 0;
    s.failures = s.failures.filter(t => t > now - 600_000).concat(now);
    s.attemptCount = s.failures.length; s.attemptWindowStart = s.failures[0];
    s.cooldownUntil = 0;
    return "not_following";
  }
  if (action === "begin") {
    if (s.currentCheckId === id) return result("duplicate_event");
    if ((s.state === "checking" || s.settling) && now < s.deadline) return result("duplicate_click");
    // A new tap always gets feedback. Only overlapping checks share a lease;
    // elapsed-time debouncing must not hide another real user action. Old
    // cooldown states are accepted here so rollout needs no production reset.
    if (s.state === "cooldown") { s.failures = []; s.attemptCount = 0; s.cooldownUntil = 0; }
    // The 45s lease covers 8+2+8s API retries plus result delivery.
    s.state = "checking"; s.currentCheckId = id; s.checkStartedAt = now;
    s.deadline = now + FOLLOW_CHECK_LEASE_MS; s.lastEventAt = Number(value); s.settling = false;
    return result("started");
  }
  if (s.currentCheckId !== id) return result("stale");
  if (action === "current") return result((s.state === "checking" || s.settling) && now < s.deadline ? "current" : "stale");
  if (action === "complete") {
    if (s.state !== "checking" || s.settling || now >= s.deadline) return result("stale");
    const outcome = complete(value); s.settling = true; return result(outcome);
  }
  if (action === "expire") {
    if (now < s.deadline) return result("not_due");
    if (s.settling) { s.settling = false; return result("delivery_unconfirmed"); }
    if (s.state !== "checking") return result("stale");
    const outcome = complete("null"); s.settling = true; s.deadline = now + FOLLOW_CHECK_LEASE_MS;
    return result(outcome);
  }
  if (action === "release") {
    if (s.state === "checking") s.state = "prompted";
    s.settling = false;
    if (value === "sent" && s.state === "followed") s.lastNextStepSentAt = now;
    return result("released");
  }
  if (action === "cancel" && s.state === "checking") {
    s.state = "prompted"; s.settling = false; s.currentCheckId = ""; s.lastEventAt = 0;
    return result("cancelled");
  }
  return result("stale");
}

export function followGateKey(accountId: string, campaignId: string, userId: string): string {
  return `follow_gate:v1:${createHash("sha256").update(JSON.stringify([accountId, campaignId, userId])).digest("hex")}`;
}

/** A stalled original job can repair a crash between CAS and watchdog enqueue.
 * Only the still-pending matching check is eligible; settled or newer checks
 * must never be restarted. The watchdog itself rechecks ownership atomically.
 */
export async function pendingFollowGateRecoveryDelay(key: string, checkId: string): Promise<number | null> {
  const raw = await getRedisConnection().get(key);
  if (!raw) return null;
  const state = JSON.parse(raw) as FollowGateState;
  if (state.currentCheckId !== checkId || state.state !== "checking" || state.settling) return null;
  return Math.max(0, state.deadline - Date.now());
}

export async function transitionFollowGate(
  key: string, action: FollowGateAction, checkId: string, value: string | number = "",
): Promise<string> {
  const redis = getRedisConnection();
  for (let retry = 0; retry < 32; retry++) {
    const raw = await redis.get(key);
    const previous = raw ? JSON.parse(raw) as FollowGateState : initialFollowGateState();
    const next = nextFollowGateState(previous, action, checkId, Date.now(), value);
    const encoded = JSON.stringify(next.state);
    if (encoded === raw || (!raw && encoded === JSON.stringify(previous))) return next.result;
    if (await redis.eval(FOLLOW_GATE_CAS, 1, key, raw ?? "", encoded, STATE_TTL_MS) === 1) return next.result;
  }
  throw new Error("Follow gate contention; no lookup or message was started");
}
