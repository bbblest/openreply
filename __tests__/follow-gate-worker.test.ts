import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { createHash } from "node:crypto";
import { memoryGateRedis } from "./helpers/follow-gate-redis";

const m = vi.hoisted(() => ({
  db: {
    automation: { findFirst: vi.fn(), findMany: vi.fn() },
    dmLog: { findFirst: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), upsert: vi.fn(), updateMany: vi.fn() },
    postbackDelivery: { findUnique: vi.fn(), create: vi.fn(), delete: vi.fn() },
    operationalEvent: { create: vi.fn() },
  },
  read: vi.fn(), text: vi.fn(), button: vi.fn(), link: vi.fn(), privateButton: vi.fn(),
  claim: vi.fn(), add: vi.fn(), redis: vi.fn(), alert: vi.fn(), processor: undefined as unknown,
}));
vi.mock("@/lib/db/client", () => ({ prisma: m.db }));
vi.mock("@/lib/gifts/claims", () => ({ createGiftClaim: m.claim, processGiftDelivery: vi.fn() }));
vi.mock("@/lib/queue/client", () => ({
  getRedisConnection: m.redis, getDMQueue: () => ({ add: m.add }),
  POSTBACK_JOB_NAME: "process-postback", MESSAGE_JOB_NAME: "process-message",
  GIFT_JOB_NAME: "process-gift-claim", FOLLOWUP_JOB_NAME: "process-followup",
}));
vi.mock("@/lib/ops/worker-health", () => ({ recordWorkerAlert: m.alert }));
vi.mock("@/lib/instagram/provider", async importOriginal => ({
  ...await importOriginal<typeof import("@/lib/instagram/provider")>(),
  hasInstagramCredentials: () => true,
  createInstagramContext: async () => ({ provider: "META", accessToken: "test-only" }),
  getUserFollowStatus: m.read, sendDirectMessage: m.text, sendDirectMessageWithButton: m.button,
  sendDirectMessageWithLinkButton: m.link, sendPrivateReplyWithButton: m.privateButton,
}));
vi.mock("@/lib/billing/usage", () => ({ reserveWorkspaceDMSend: async () => ({ allowed: true }), releaseWorkspaceDMReservation: vi.fn() }));
vi.mock("@/lib/utils/rate-limiter", () => ({ reserveDMSlot: async () => ({ allowed: true }), releaseDMSlot: vi.fn() }));
vi.mock("bullmq", () => ({
  Worker: class { constructor(_name: string, process: unknown) { m.processor = process; } on() {} },
  UnrecoverableError: class extends Error {},
}));
import { createDMWorker } from "@/lib/queue/dm-worker";
import { followGateKey, transitionFollowGate, type FollowGateState } from "@/lib/queue/follow-gate-state";
import { SAFE_FOLLOW_MESSAGES } from "@/lib/instagram/follow-policy";

const campaign = {
  id: "campaign-test", workspaceId: "workspace-test", instagramAccountId: "account-test",
  instagramAccount: { instagramId: "owner-test", provider: "META", accessToken: "test" },
  isActive: true, requireFollow: true, requireEmail: true, dmTriggerEnabled: true,
  keywords: ["禮物"], wholeWordMatch: false, trackedLinks: [], dmMessage: "gift-private", workspace: {},
  publicReplyMessages: [], publicReplyEnabled: false,
};
type Data = { instagramAccountId: string; userId: string; payload: string; mid?: string; eventAt?: number; followTimeoutCheckId?: string };
let redis: ReturnType<typeof memoryGateRedis>;
let deliveries: Set<string>;
const key = followGateKey("account-test", campaign.id, "person-test");
const state = () => JSON.parse(redis.values.get(key)!) as FollowGateState;
function tap(id: string, extra: Partial<Data> = {}) {
  return { name: "process-postback", id, attemptsMade: 0, timestamp: Date.now(), data: {
    instagramAccountId: "owner-test", userId: "person-test", payload: `followcheck:${campaign.id}`,
    mid: id, eventAt: Date.now(), ...extra,
  } };
}
const run = (job: ReturnType<typeof tap> | Record<string, unknown>) =>
  (m.processor as (job: unknown) => Promise<void>)(job);
async function settle(promise: Promise<void>) { await vi.runAllTimersAsync(); await promise; }
function recoveryJob() {
  const call = m.add.mock.calls.find(([, data]) => data.followTimeoutCheckId)!;
  return { name: "process-postback", id: call[2].jobId, attemptsMade: 0, data: call[1] };
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-24T00:00:19.500Z"));
  vi.stubEnv("REQUIRE_VERIFIED_EMAIL", "true");
  vi.stubEnv("REQUIRE_CONFIRMED_FOLLOW", "true");
  redis = memoryGateRedis(); m.redis.mockReturnValue(redis); deliveries = new Set();
  m.db.automation.findFirst.mockResolvedValue(campaign); m.db.automation.findMany.mockResolvedValue([campaign]);
  m.db.dmLog.findFirst.mockImplementation(async ({ where }) => where.status ? null : { commenterName: "測試" });
  m.db.dmLog.updateMany.mockResolvedValue({ count: 1 });
  m.db.operationalEvent.create.mockResolvedValue({});
  m.db.postbackDelivery.findUnique.mockImplementation(async ({ where }) => deliveries.has(where.id) ? { id: where.id } : null);
  m.db.postbackDelivery.create.mockImplementation(async ({ data }) => {
    if (deliveries.has(data.id)) throw Object.assign(new Error("Duplicate"), { code: "P2002" });
    deliveries.add(data.id); return data;
  });
  m.db.postbackDelivery.delete.mockImplementation(async ({ where }) => deliveries.delete(where.id));
  m.claim.mockResolvedValue({ claimId: "test", stage: "unverified", url: "https://test.invalid/gift/signed-test-token" });
  m.read.mockResolvedValue(false);
  m.text.mockResolvedValue({ message_id: "text" }); m.button.mockResolvedValue({ message_id: "button" });
  m.link.mockResolvedValue({ message_id: "link" }); m.privateButton.mockResolvedValue({ message_id: "private" });
  m.add.mockResolvedValue({}); m.alert.mockResolvedValue(undefined);
  createDMWorker();
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("follow gate concurrency and bounded completion (real worker + state + retry; mock transports)", () => {
  it("10 presses in 1.8s: one active lookup, one result and 9 distinct tap replies", async () => {
    const logs = vi.spyOn(console, "info");
    m.read.mockImplementation(() => new Promise(resolve => setTimeout(() => resolve(false), 4_000)));
    const tasks = [run(tap("tap0"))];
    for (let i = 1; i < 10; i++) { await vi.advanceTimersByTimeAsync(200); tasks.push(run(tap(`tap${i}`))); }
    await vi.advanceTimersByTimeAsync(1200); expect(m.text).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1000); await Promise.all(tasks);
    expect(m.read).toHaveBeenCalledTimes(1); expect(m.button).toHaveBeenCalledTimes(10);
    expect(m.button.mock.calls.filter(([args]) => args.text === SAFE_FOLLOW_MESSAGES.checkInProgress)).toHaveLength(9);
    expect(m.button.mock.calls.filter(([args]) => args.text === SAFE_FOLLOW_MESSAGES.retryPrompt)).toHaveLength(1);
    expect(m.claim).not.toHaveBeenCalled(); expect(m.add).toHaveBeenCalledTimes(1);
    expect(logs.mock.calls.filter(([, entry]) => String(entry).includes('"duplicate_click"'))).toHaveLength(9);
    expect(state().state).toBe("prompted");
    // The same processor remains usable for another person (no process crash).
    await settle(run(tap("other", { userId: "other-person" })));
    expect(m.button).toHaveBeenCalledTimes(11);
  });

  it("shares concurrent lookup but replies to each tap; a subsequent tap checks again immediately", async () => {
    await Promise.all(Array.from({ length: 10 }, (_, i) => run(tap(`parallel${i}`))));
    expect(m.read).toHaveBeenCalledTimes(1); expect(m.button).toHaveBeenCalledTimes(10);
    expect(m.text).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(200); await run(tap("fast-again"));
    expect(m.read).toHaveBeenCalledTimes(2); expect(m.button).toHaveBeenCalledTimes(11);
  });

  it("every queued distinct click gets a reply even when its event time is within the former debounce", async () => {
    const queued = Array.from({ length: 10 }, (_, i) => tap(`queued${i}`, { eventAt: Date.now() + i * 150 }));
    await run(queued[0]); await vi.advanceTimersByTimeAsync(20_000);
    for (const job of queued.slice(1)) await run(job);
    expect(m.read).toHaveBeenCalledTimes(10);
    expect(m.button).toHaveBeenCalledTimes(10);
  });

  it("six rapid false results each explain the gift condition; following then works immediately", async () => {
    for (let i = 0; i < 6; i++) { await run(tap(`false${i}`)); await vi.advanceTimersByTimeAsync(200); }
    expect(m.read).toHaveBeenCalledTimes(6); expect(m.button).toHaveBeenCalledTimes(6);
    for (const [args] of m.button.mock.calls) {
      expect(args.text).toBe(SAFE_FOLLOW_MESSAGES.retryPrompt);
      expect(args.text).toContain("還沒確認到你的追蹤"); expect(args.text).toContain("禮物");
    }
    expect(state().state).toBe("prompted"); expect(state().cooldownUntil).toBe(0);
    expect(m.claim).not.toHaveBeenCalled();
    m.read.mockResolvedValueOnce(true); await run(tap("followed-now"));
    expect(m.read).toHaveBeenCalledTimes(7); expect(m.claim).toHaveBeenCalledTimes(1);
  });

  it("existing production cooldown resumes on a new tap without deleting state or dedupe", async () => {
    const old = tap("before-rollout"); await run(old);
    redis.values.set(key, JSON.stringify({ ...state(), state: "cooldown", cooldownUntil: Date.now() + 1_800_000 }));
    await run(old); expect(m.button).toHaveBeenCalledTimes(1);
    await run(tap("after-rollout")); expect(m.read).toHaveBeenCalledTimes(2);
    expect(m.button).toHaveBeenCalledTimes(2); expect(state().state).toBe("prompted");
  });

  it("redelivery of an overlapping tap replies once without disrupting the original lookup", async () => {
    m.read.mockImplementationOnce(() => new Promise(resolve => setTimeout(() => resolve(false), 4_000)));
    const original = run(tap("still-checking")); await vi.advanceTimersByTimeAsync(100);
    const busy = tap("real-busy-click"); await Promise.all([run(busy), run(busy)]);
    expect(m.button).toHaveBeenCalledTimes(1); expect(state().state).toBe("checking");
    await vi.advanceTimersByTimeAsync(3900); await original;
    redis.values.clear(); await run(busy);
    expect(m.button).toHaveBeenCalledTimes(2); expect(m.read).toHaveBeenCalledTimes(1);
  });

  it("a failed busy reply never releases the active check and an uncertain send is not repeated", async () => {
    m.read.mockImplementationOnce(() => new Promise(resolve => setTimeout(() => resolve(false), 4_000)));
    const original = run(tap("active-owner")); await vi.advanceTimersByTimeAsync(100);
    m.button.mockRejectedValueOnce(new Error("unknown delivery"));
    const busy = tap("busy-send-error"); await expect(run(busy)).rejects.toThrow("unconfirmed");
    expect(state().state).toBe("checking"); await run(busy);
    await vi.advanceTimersByTimeAsync(3900); await original;
    expect(m.button).toHaveBeenCalledTimes(2); expect(m.read).toHaveBeenCalledTimes(1);
  });

  it("rolling window drops old failures rather than resetting all at a fixed boundary", async () => {
    await run(tap("old")); await vi.advanceTimersByTimeAsync(9 * 60_000);
    await run(tap("recent")); await vi.advanceTimersByTimeAsync(61_000);
    await run(tap("later")); expect(state().attemptCount).toBe(2);
  });

  it("a provider that never resolves is aborted twice and gives a final unknown by 18s", async () => {
    const signals: AbortSignal[] = [];
    m.read.mockImplementation(({ signal }) => { signals.push(signal); return new Promise(() => {}); });
    const checking = run(tap("timeout"));
    await vi.advanceTimersByTimeAsync(2999); expect(m.text).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1); expect(m.text).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(15_000); await checking;
    expect(m.read).toHaveBeenCalledTimes(2); expect(signals.every(s => s.aborted)).toBe(true);
    expect(m.button).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ text: SAFE_FOLLOW_MESSAGES.unknown }));
    expect(state().unknownCount).toBe(1); expect(m.claim).not.toHaveBeenCalled();
    await settle(run(tap("timeout-again")));
    expect(state().unknownCount).toBe(2); expect(m.claim).not.toHaveBeenCalled();
  });

  it("retry can succeed; a new tap checks current follow status even within 60s", async () => {
    m.read.mockRejectedValueOnce(new Error("test-only")).mockResolvedValueOnce(true);
    await settle(run(tap("retry")));
    expect(m.claim).toHaveBeenCalledTimes(1); expect(m.link).toHaveBeenCalledTimes(1);
    expect(m.text).not.toHaveBeenCalled(); expect(state().state).toBe("followed");
    await vi.advanceTimersByTimeAsync(200); m.read.mockResolvedValue(false);
    await run(tap("unfollowed")); expect(m.read).toHaveBeenCalledTimes(3);
    expect(m.claim).toHaveBeenCalledTimes(1); expect(m.button).toHaveBeenCalledTimes(1);
  });

  it("an old API result cannot release the gift after another check owns the gate", async () => {
    let late: (value: boolean) => void = () => {};
    m.read.mockImplementationOnce(() => new Promise(resolve => { late = resolve; }));
    const old = run(tap("old-check")); await vi.advanceTimersByTimeAsync(1);
    // Simulate lease replacement by another instance without losing the old promise.
    const replacement = { ...state(), currentCheckId: "newer-operation" };
    redis.values.set(key, JSON.stringify(replacement)); late(true); await old;
    expect(m.claim).not.toHaveBeenCalled(); expect(m.link).not.toHaveBeenCalled();
    expect(state().currentCheckId).toBe("newer-operation");
  });

  it("watchdog finishes a persisted checking state left by a lost process, exactly once", async () => {
    await run(tap("bootstrap"));
    const watchdog = recoveryJob();
    const saved = { ...state(), state: "checking", settling: false };
    redis.values.set(key, JSON.stringify(saved)); deliveries.delete(saved.currentCheckId);
    m.button.mockClear(); m.read.mockClear();
    await vi.advanceTimersByTimeAsync(45_000);
    createDMWorker(); await run(watchdog); await run(watchdog);
    expect(m.read).not.toHaveBeenCalled(); expect(m.button).toHaveBeenCalledTimes(1);
    expect(m.button).toHaveBeenCalledWith(expect.objectContaining({ text: SAFE_FOLLOW_MESSAGES.unknown }));
    expect(state().state).toBe("prompted");
  });

  it("watchdog cannot overwrite a newer check or repeat a completed result", async () => {
    await run(tap("first")); const watchdog = recoveryJob();
    await vi.advanceTimersByTimeAsync(16_000); await run(tap("newer"));
    await vi.advanceTimersByTimeAsync(45_000); await run(watchdog);
    expect(m.button).toHaveBeenCalledTimes(2); expect(m.read).toHaveBeenCalledTimes(2);
  });

  it("a stalled original repairs a crash after Redis CAS but before watchdog enqueue", async () => {
    const original = tap("crashed-before-enqueue");
    const id = createHash("sha256").update(JSON.stringify(["account-test", campaign.id, "person-test", original.data.mid])).digest("hex");
    await transitionFollowGate(key, "begin", id, original.data.eventAt);
    await vi.advanceTimersByTimeAsync(60_000);
    await run(original);
    expect(m.read).not.toHaveBeenCalled();
    expect(m.add).toHaveBeenCalledWith("process-postback", expect.objectContaining({ followTimeoutCheckId: id }),
      expect.objectContaining({ jobId: `follow_timeout_${id}`, delay: 0 }));
    expect(state().state).toBe("checking");
    await run(recoveryJob()); await run(recoveryJob());
    expect(m.button).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ text: SAFE_FOLLOW_MESSAGES.unknown }));
    expect(state().state).toBe("prompted");
    expect(m.claim).not.toHaveBeenCalled();
  });

  it("failed watchdog repair does not release an existing check owned by another execution", async () => {
    const original = tap("pending-original");
    const id = createHash("sha256").update(JSON.stringify(["account-test", campaign.id, "person-test", original.data.mid])).digest("hex");
    await transitionFollowGate(key, "begin", id, original.data.eventAt);
    m.add.mockRejectedValueOnce(new Error("test queue down"));
    await expect(run(original)).rejects.toThrow("test queue down");
    expect(state().state).toBe("checking"); expect(state().currentCheckId).toBe(id);
    expect(m.read).not.toHaveBeenCalled(); expect(m.button).not.toHaveBeenCalled();
  });

  it("queue failure happens before acknowledgement/read and releases the lease for retry", async () => {
    m.add.mockRejectedValueOnce(new Error("test queue unavailable"));
    const job = tap("queue-error"); await expect(run(job)).rejects.toThrow("test queue unavailable");
    expect(m.read).not.toHaveBeenCalled(); expect(m.text).not.toHaveBeenCalled();
    await run(job); expect(m.read).toHaveBeenCalledTimes(1);
  });

  it("hung acknowledgement cannot hide the final result or leave the worker occupied", async () => {
    m.text.mockImplementationOnce(() => new Promise(() => {}));
    m.read.mockImplementation(() => new Promise(resolve => setTimeout(() => resolve(false), 4_000)));
    const checking = run(tap("slow-ack")); await vi.advanceTimersByTimeAsync(11_000); await checking;
    expect(m.button).toHaveBeenCalledTimes(1); expect(state().settling).toBe(false);
  });

  it("uncertain final send fails visibly, retains dedupe and allows a later new click", async () => {
    m.button.mockRejectedValueOnce(new Error("test send uncertain"));
    const job = tap("send-error"); await expect(run(job)).rejects.toThrow("unconfirmed");
    await run(job); expect(m.button).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(16_000); await run(tap("new-click"));
    expect(m.button).toHaveBeenCalledTimes(2);
  });

  it("completed webhook stays deduped after Redis state expires", async () => {
    const job = tap("duplicate"); await run(job); redis.values.clear();
    await run(job); expect(m.read).toHaveBeenCalledTimes(1); expect(m.button).toHaveBeenCalledTimes(1);
  });

  it("a late response from the first timed-out read cannot override a retry rejection", async () => {
    let late: (value: boolean) => void = () => {};
    m.read.mockImplementationOnce(() => new Promise(resolve => { late = resolve; })).mockResolvedValueOnce(false);
    await settle(run(tap("late-api")));
    late(true); await vi.advanceTimersByTimeAsync(1);
    expect(m.button).toHaveBeenCalledTimes(1); expect(m.claim).not.toHaveBeenCalled();
  });

  it("a delayed acknowledgement DB claim cannot send checking after the final answer", async () => {
    const original = m.db.postbackDelivery.create.getMockImplementation()!;
    m.db.postbackDelivery.create.mockImplementation(async args => {
      if (args.data.id.endsWith(":ack")) await new Promise(resolve => setTimeout(resolve, 12_000));
      return original(args);
    });
    m.read.mockImplementation(() => new Promise(resolve => setTimeout(() => resolve(false), 4_000)));
    const checking = run(tap("slow-db")); await vi.advanceTimersByTimeAsync(11_000); await checking;
    expect(m.button).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(m.text).not.toHaveBeenCalled();
  });

  it("checks ownership again after creating the email claim before sending its link", async () => {
    let finishClaim: (value: unknown) => void = () => {};
    m.read.mockResolvedValue(true);
    m.claim.mockImplementation(() => new Promise(resolve => { finishClaim = resolve; }));
    const checking = run(tap("slow-claim")); await vi.advanceTimersByTimeAsync(1);
    redis.values.set(key, JSON.stringify({ ...state(), currentCheckId: "new-check" }));
    finishClaim({ stage: "unverified", url: "https://test.invalid/gift/claim" }); await checking;
    expect(m.link).not.toHaveBeenCalled(); expect(state().currentCheckId).toBe("new-check");
  });

  it("a hung final send is bounded, records uncertainty, and never auto-resends the event", async () => {
    m.button.mockImplementationOnce(() => new Promise(() => {}));
    const job = tap("hung-final");
    const result = expect(run(job)).rejects.toThrow("unconfirmed");
    await vi.advanceTimersByTimeAsync(8_000); await result;
    expect(state().settling).toBe(false);
    await run(job); expect(m.button).toHaveBeenCalledTimes(1);
  });

  it.each(["comment", "message"])("%s entry still prompts first, then uses the same check", async source => {
    const data = source === "comment"
      ? { instagramAccountId: "owner-test", commentId: "comment-test", commentText: "禮物", commenterId: "person-test", mediaId: "media-test" }
      : { instagramAccountId: "owner-test", messageId: "message-test", messageText: "禮物", senderId: "person-test" };
    await run({ name: `process-${source}`, id: `entry-${source}`, attemptsMade: 0, data });
    expect(m.read).not.toHaveBeenCalled(); expect(m.claim).not.toHaveBeenCalled();
    const prompt = source === "comment" ? m.privateButton : m.button;
    expect(prompt).toHaveBeenCalledWith(expect.objectContaining({ payload: `followcheck:${campaign.id}` }));
    await run(tap(`entry-${source}-button`)); expect(m.read).toHaveBeenCalledTimes(1);
    expect(m.claim).not.toHaveBeenCalled();
  });
});
