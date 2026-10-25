import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { db, followStatus, instagramContext, credentials, mailReady, verificationMail, deliveryMail, relayReady, relaySend, queueAdd, redisEval, instagramSend } = vi.hoisted(() => ({
  db: {
    giftClaim: { findUnique: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    giftContact: { upsert: vi.fn(), updateMany: vi.fn() },
    automation: { findUnique: vi.fn() },
    $transaction: vi.fn(),
    $executeRaw: vi.fn(),
  },
  followStatus: vi.fn(), instagramContext: vi.fn(), credentials: vi.fn(), mailReady: vi.fn(),
  verificationMail: vi.fn(), deliveryMail: vi.fn(), queueAdd: vi.fn(), redisEval: vi.fn(), instagramSend: vi.fn(),
  relayReady: vi.fn(), relaySend: vi.fn(),
}));

vi.mock("@/lib/db/client", () => ({ prisma: db }));
vi.mock("@/lib/instagram/provider", () => ({
  createInstagramContext: instagramContext, getUserFollowStatus: followStatus, hasInstagramCredentials: credentials,
}));
vi.mock("@/lib/queue/client", () => ({
  GIFT_JOB_NAME: "process-gift-claim", getDMQueue: () => ({ add: queueAdd }), getRedisConnection: () => ({ eval: redisEval }),
}));
vi.mock("@/lib/gifts/mailer", () => ({
  getGiftMailConfiguration: mailReady, sendGiftVerificationEmail: verificationMail, sendGiftDeliveryEmail: deliveryMail,
  GiftMailError: class GiftMailError extends Error {
    constructor(message: string, public readonly deliveryUnconfirmed: boolean) { super(message); }
  },
}));
vi.mock("@/lib/gifts/mail-relay", () => ({
  isGiftMailRelayConfigured: relayReady, relayGiftDeliveryEmail: relaySend,
}));

import {
  confirmGiftEmail, createGiftClaim, getGiftClaimView, normalizeGiftEmail, processGiftDelivery, reconcileGiftDeliveries,
  requestGiftVerification,
} from "../lib/gifts/claims";
import { GiftMailError } from "../lib/gifts/mailer";
import { giftTokenHash, signGiftAccess } from "../lib/gifts/tokens";
import { RateLimitError } from "../lib/meta/client";

const NOW = new Date("2026-10-23T01:00:00.000Z");
const DAY = 86_400_000;
const verificationToken = "A".repeat(43);

function freshClaim() {
  return {
    id: "claim_test", workspaceId: "workspace_test", automationId: "campaign_test", recipientId: "ig_person_test", round: 1,
    recipientName: "測試使用者", followConfirmedAt: new Date(NOW.getTime() - 60_000), expiresAt: new Date(NOW.getTime() + DAY),
    email: "recipient@recipient.test" as string | null, emailVersion: 1,
    verificationTokenHash: giftTokenHash(verificationToken) as string | null,
    verificationExpiresAt: new Date(NOW.getTime() + 1_800_000) as Date | null,
    verificationSentAt: new Date(NOW.getTime() - 120_000) as Date | null,
    verificationCount: 1, verificationWindowStart: new Date(NOW), verificationStatus: "SENT",
    emailVerifiedAt: new Date(NOW.getTime() - 10_000) as Date | null, marketingConsent: false,
    contactId: "contact_test" as string | null,
    contact: { id: "contact_test", workspaceId: "workspace_test", email: "recipient@recipient.test",
      emailVerifiedAt: new Date(NOW.getTime() - 10_000) as Date | null, unsubscribedAt: null },
    igStatus: "PENDING", emailStatus: "PENDING", igAttempts: 0, emailAttempts: 0,
    igSentAt: null as Date | null, emailSentAt: null as Date | null, lastError: null as string | null,
    nextAttemptAt: new Date(NOW), leaseId: null as string | null, leaseUntil: null as Date | null,
    automation: {
      id: "campaign_test", workspaceId: "workspace_test", instagramAccountId: "ig_account_test", isActive: true,
      requireEmail: true, requireFollow: true, dmMessage: "PRIVATE_GIFT {link}", linkButtonLabel: "領取禮物",
      instagramAccount: { provider: "META", workspaceId: "workspace_test", instagramId: "ig_business_test", accessToken: "fake-token", zernioAccountId: null },
      trackedLinks: [{ slug: "opaque-gift", label: "領取禮物", destinationUrl: "https://www.youtube.com/watch?v=fake-test-gift" }],
    },
  };
}
type Claim = ReturnType<typeof freshClaim>;
type Row = Record<string, unknown>;
let claim: Claim;

// Small in-memory repository: conditional writes are atomic and reads are
// snapshots, so the tests exercise real version/lease races without a database.
function scalar(value: unknown): string | number | boolean | null | undefined {
  return value instanceof Date ? value.getTime() : value as string | number | boolean | null | undefined;
}
function matches(row: Row, where: Row): boolean {
  return Object.entries(where).every(([key, expected]) => {
    if (key === "OR") return (expected as Row[]).some((part) => matches(row, part));
    if (key === "AND") return (expected as Row[]).every((part) => matches(row, part));
    const actual = row[key];
    if (key === "automation" && actual && typeof actual === "object") return matches(actual as Row, expected as Row);
    if (expected && typeof expected === "object" && !(expected instanceof Date)) {
      const filter = expected as Row;
      return Object.entries(filter).every(([operator, wanted]) => {
        if (operator === "not") return scalar(actual) !== scalar(wanted);
        if (operator === "in") return (wanted as unknown[]).some((value) => scalar(actual) === scalar(value));
        if (actual === null || actual === undefined) return false;
        if (operator === "lt") return scalar(actual)! < scalar(wanted)!;
        if (operator === "lte") return scalar(actual)! <= scalar(wanted)!;
        if (operator === "gt") return scalar(actual)! > scalar(wanted)!;
        throw new Error(`Unsupported test repository operator: ${operator}`);
      });
    }
    return scalar(actual) === scalar(expected);
  });
}
function apply(data: Row) {
  const record = claim as unknown as Row;
  for (const [key, value] of Object.entries(data)) {
    record[key] = value && typeof value === "object" && "increment" in value
      ? Number(record[key]) + Number(value.increment) : value;
  }
}
function accessToken() { return signGiftAccess(claim.id, "claim", claim.expiresAt); }
function unverified() { claim.emailVerifiedAt = null; claim.contactId = null; }
function sendGift() { return processGiftDelivery(claim.id, { sendInstagramGift: instagramSend }); }
function expectNoGift() {
  expect(instagramSend).not.toHaveBeenCalled();
  expect(deliveryMail).not.toHaveBeenCalled();
  expect(relaySend).not.toHaveBeenCalled();
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  vi.stubEnv("REQUIRE_VERIFIED_EMAIL", "false");
  vi.stubEnv("REQUIRE_CONFIRMED_FOLLOW", "false");
  vi.stubEnv("NEXTAUTH_SECRET", "fake-test-secret-for-gift-signatures");
  vi.stubEnv("NEXTAUTH_URL", "https://gift-test.invalid");
  claim = freshClaim();
  db.automation.findUnique.mockImplementation(async () => structuredClone(claim.automation));
  db.giftClaim.findFirst.mockImplementation(async () => structuredClone(claim));
  db.giftClaim.create.mockImplementation(async ({ data }: { data: Row }) => ({
    id: "new_round", email: null, emailVerifiedAt: null, igStatus: "PENDING", emailStatus: "PENDING", ...data,
  }));
  db.giftClaim.findUnique.mockImplementation(async ({ where }: { where: Row }) => matches(claim as unknown as Row, where) ? structuredClone(claim) : null);
  db.giftClaim.findMany.mockImplementation(async ({ where }: { where: Row }) => matches(claim as unknown as Row, where) ? [{ id: claim.id }] : []);
  db.giftClaim.updateMany.mockImplementation(async ({ where, data }: { where: Row; data: Row }) => {
    if (!matches(claim as unknown as Row, where)) return { count: 0 };
    apply(data);
    return { count: 1 };
  });
  db.giftClaim.update.mockImplementation(async ({ where, data }: { where: Row; data: Row }) => {
    if (!matches(claim as unknown as Row, where)) throw new Error("Record missing");
    apply(data);
    return structuredClone(claim);
  });
  db.giftContact.upsert.mockResolvedValue({ id: "contact_test" });
  db.$transaction.mockImplementation(async (run: (tx: typeof db) => Promise<unknown>) => run(db));
  followStatus.mockResolvedValue(true);
  instagramContext.mockResolvedValue({ provider: "META", accessToken: "fake-token" });
  credentials.mockReturnValue(true);
  mailReady.mockReturnValue({ ready: true });
  verificationMail.mockResolvedValue({ messageId: "verification_test" });
  deliveryMail.mockResolvedValue({ messageId: "email_test" });
  relayReady.mockReturnValue(false);
  relaySend.mockResolvedValue(undefined);
  instagramSend.mockResolvedValue(undefined);
  queueAdd.mockResolvedValue({ id: "job_test" });
  redisEval.mockResolvedValue(1);
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

describe("returning gift recipients", () => {
  function revisit() {
    return createGiftClaim({ automationId: claim.automationId, recipientId: claim.recipientId,
      recipientName: claim.recipientName, followConfirmedAt: new Date(NOW) });
  }

  it("starts a fresh unverified round without changing completed history or sending gifts", async () => {
    claim.igStatus = "SENT";
    claim.emailStatus = "SENT";
    claim.igAttempts = 1;
    claim.emailAttempts = 1;
    claim.igSentAt = new Date(NOW.getTime() - 60_000);
    claim.emailSentAt = new Date(NOW.getTime() - 55_000);
    const history = {
      email: claim.email, emailVersion: claim.emailVersion, emailVerifiedAt: claim.emailVerifiedAt,
      verificationStatus: claim.verificationStatus, marketingConsent: claim.marketingConsent,
      igStatus: claim.igStatus, emailStatus: claim.emailStatus, igAttempts: claim.igAttempts, emailAttempts: claim.emailAttempts,
      igSentAt: claim.igSentAt, emailSentAt: claim.emailSentAt,
    };
    const result = await revisit();
    expect(result).toMatchObject({ claimId: "new_round", stage: "unverified", igStatus: "PENDING", emailStatus: "PENDING" });
    expect(db.giftClaim.create).toHaveBeenCalledWith({ data: expect.objectContaining({ round: 2 }) });
    expect(db.giftClaim.update).not.toHaveBeenCalled();
    expect(result.url).toContain("/gift/claim?token=");
    expect(claim).toMatchObject(history);
    expect(queueAdd).not.toHaveBeenCalled();
    expect(verificationMail).not.toHaveBeenCalled();
    expectNoGift();
  });

  it("keeps an unverified recipient in the email flow without a delivery job", async () => {
    unverified();
    claim.email = null;
    expect(await revisit()).toMatchObject({ stage: "unverified", igStatus: "PENDING", emailStatus: "PENDING" });
    expect(claim.emailVerifiedAt).toBeNull();
    expect(queueAdd).not.toHaveBeenCalled();
    expect(verificationMail).not.toHaveBeenCalled();
    expectNoGift();
  });

  it("revisiting a verified partial delivery does not resend its successful channel", async () => {
    claim.igStatus = "SENT";
    claim.igAttempts = 1;
    claim.igSentAt = new Date(NOW.getTime() - 60_000);
    const originalSentAt = claim.igSentAt;
    expect(await revisit()).toMatchObject({ stage: "verified", igStatus: "SENT", emailStatus: "PENDING" });
    expect(queueAdd).toHaveBeenCalledTimes(1);
    await sendGift();
    expect(instagramSend).not.toHaveBeenCalled();
    expect(deliveryMail).toHaveBeenCalledTimes(1);
    expect(claim.igAttempts).toBe(1);
    expect(claim.igSentAt).toEqual(originalSentAt);
  });

  it.each(["UNCONFIRMED", "SENDING", "FAILED"])("revisiting does not reset a stopped email channel (%s)", async (status) => {
    claim.igStatus = "SENT";
    claim.igAttempts = 1;
    claim.emailStatus = status;
    claim.emailAttempts = status === "FAILED" ? 3 : 1;
    const attempts = claim.emailAttempts;
    expect(await revisit()).toMatchObject({ stage: "verified", igStatus: "SENT", emailStatus: status });
    await sendGift();
    expectNoGift();
    expect(claim.emailStatus).toBe(status);
    expect(claim.emailAttempts).toBe(attempts);
  });
});

describe("gift claim release gates", () => {
  it("never sends either gift channel before email verification", async () => {
    unverified();
    await sendGift();
    expectNoGift();
    expect(followStatus).not.toHaveBeenCalled();
  });

  it.each([false, null, "error"] as const)("withholds both channels for fresh follow status %s", async (status) => {
    if (status === "error") followStatus.mockRejectedValue(new Error("provider unavailable"));
    else followStatus.mockResolvedValue(status);
    await sendGift();
    expectNoGift();
    expect(claim.igStatus).toBe("PENDING");
    expect(claim.emailStatus).toBe("PENDING");
    expect(claim.nextAttemptAt.getTime()).toBe(NOW.getTime() + 300_000);
    expect(claim.leaseId).toBeNull();
  });

  it("delivers independent IG and email messages only after both gates pass", async () => {
    await sendGift();
    expect(followStatus).toHaveBeenCalledWith({ context: { provider: "META", accessToken: "fake-token" }, recipientId: "ig_person_test" });
    expect(instagramSend).toHaveBeenCalledTimes(1);
    expect(deliveryMail).toHaveBeenCalledWith(expect.objectContaining({ to: "recipient@recipient.test", links: [{ label: "領取禮物", url: "https://gift-test.invalid/r/opaque-gift" }], deliveryKey: "gift-claim_test" }));
    expect(claim.igStatus).toBe("SENT");
    expect(claim.emailStatus).toBe("SENT");
    expect(claim.leaseId).toBeNull();
  });

  it("does not resend successful IG when only the email must retry", async () => {
    deliveryMail.mockRejectedValueOnce(new GiftMailError("rejected", false));
    await sendGift();
    expect(claim.igStatus).toBe("SENT");
    expect(claim.emailStatus).toBe("FAILED");
    vi.setSystemTime(NOW.getTime() + 300_001);
    await sendGift();
    expect(instagramSend).toHaveBeenCalledTimes(1);
    expect(deliveryMail).toHaveBeenCalledTimes(2);
    expect(claim.emailStatus).toBe("SENT");
  });

  it("does not resend successful email when only IG must retry", async () => {
    instagramSend.mockRejectedValueOnce(new RateLimitError("rejected"));
    await sendGift();
    expect(claim.igStatus).toBe("FAILED");
    expect(claim.emailStatus).toBe("SENT");
    vi.setSystemTime(NOW.getTime() + 300_001);
    await sendGift();
    expect(instagramSend).toHaveBeenCalledTimes(2);
    expect(deliveryMail).toHaveBeenCalledTimes(1);
  });

  it.each(["ig", "email"])("never automatically resends an uncertain %s delivery", async (channel) => {
    if (channel === "ig") instagramSend.mockRejectedValueOnce(new Error("connection lost after submission"));
    else deliveryMail.mockRejectedValueOnce(new GiftMailError("unknown", true));
    await sendGift();
    expect(channel === "ig" ? claim.igStatus : claim.emailStatus).toBe("UNCONFIRMED");
    vi.setSystemTime(NOW.getTime() + 300_001);
    await sendGift();
    await reconcileGiftDeliveries();
    expect(instagramSend).toHaveBeenCalledTimes(1);
    expect(deliveryMail).toHaveBeenCalledTimes(1);
    expect(queueAdd).not.toHaveBeenCalled();
  });

  it("allows only one concurrent worker lease to send each channel", async () => {
    await Promise.all([sendGift(), sendGift()]);
    expect(instagramSend).toHaveBeenCalledTimes(1);
    expect(deliveryMail).toHaveBeenCalledTimes(1);
    expect(claim.igAttempts).toBe(1);
    expect(claim.emailAttempts).toBe(1);
  });

  it("blocks expired and foreign-workspace claims", async () => {
    claim.expiresAt = new Date(NOW);
    await sendGift();
    expectNoGift();
    claim.expiresAt = new Date(NOW.getTime() + DAY);
    claim.automation.workspaceId = "different_workspace";
    await sendGift();
    expectNoGift();
  });

  it("blocks a contact whose verified email does not match the claim", async () => {
    claim.contact.email = "different@recipient.test";
    await sendGift();
    expectNoGift();
  });

  it.each([
    ["unverified contact", (current: Claim) => { current.contact.emailVerifiedAt = null; }],
    ["mismatched contact email", (current: Claim) => { current.contact.email = "other@recipient.test"; }],
    ["foreign contact", (current: Claim) => { current.contact.workspaceId = "other_workspace"; }],
    ["foreign account", (current: Claim) => { current.automation.instagramAccount.workspaceId = "other_workspace"; }],
    ["foreign campaign", (current: Claim) => { current.automation.workspaceId = "other_workspace"; }],
    ["inactive campaign", (current: Claim) => { current.automation.isActive = false; }],
    ["disabled email gate", (current: Claim) => { current.automation.requireEmail = false; }],
    ["missing credentials", () => { credentials.mockReturnValue(false); }],
  ] as const)("defers %s for thirty minutes without sending or consuming attempts", async (_description, invalidate) => {
    invalidate(claim);
    await sendGift();
    expectNoGift();
    expect(followStatus).not.toHaveBeenCalled();
    expect(claim.nextAttemptAt.getTime()).toBe(NOW.getTime() + 1_800_000);
    expect(claim.igStatus).toBe("PENDING");
    expect(claim.emailStatus).toBe("PENDING");
    expect(claim.igAttempts).toBe(0);
    expect(claim.emailAttempts).toBe(0);
    expect(claim.leaseId).toBeNull();
    vi.setSystemTime(NOW.getTime() + 60_000);
    await reconcileGiftDeliveries();
    expect(queueAdd).not.toHaveBeenCalled();
  });

  it("returns only a masked address and statuses before delivery, never the gift destination", async () => {
    unverified();
    const view = await getGiftClaimView(accessToken());
    expect(view).toMatchObject({ stage: "verify", emailMasked: "r***@recipient.test" });
    expect(JSON.stringify(view)).not.toMatch(/youtube|opaque-gift|PRIVATE_GIFT|recipient@/);
  });
});

describe("gift claim mail relay", () => {
  beforeEach(() => {
    mailReady.mockReturnValue({ ready: false });
    relayReady.mockReturnValue(true);
  });

  it("lets a worker with only relay credentials create the email claim page", async () => {
    unverified();
    const result = await createGiftClaim({ automationId: claim.automationId, recipientId: claim.recipientId, recipientName: claim.recipientName, followConfirmedAt: new Date(NOW) });
    expect(result.claimId).toBe(claim.id);
    expect(result.url).toContain("https://gift-test.invalid/gift/claim?token=");
    expectNoGift();
    expect(verificationMail).not.toHaveBeenCalled();
    expect(queueAdd).not.toHaveBeenCalled();
  });

  it("uses relay for gift delivery when local SMTP is not configured", async () => {
    await sendGift();
    expect(instagramSend).toHaveBeenCalledTimes(1);
    expect(relaySend).toHaveBeenCalledWith("claim_test", 1);
    expect(deliveryMail).not.toHaveBeenCalled();
    expect(claim.igStatus).toBe("SENT");
    expect(claim.emailStatus).toBe("SENT");
  });

  it("still requires a local transport to send email verification", async () => {
    unverified();
    await expect(requestGiftVerification({ token: accessToken(), email: "recipient@recipient.test", marketingConsent: false })).rejects.toMatchObject({ status: 503 });
    expect(verificationMail).not.toHaveBeenCalled();
    expectNoGift();
    expect(redisEval).not.toHaveBeenCalled();
    expect(claim.emailVersion).toBe(1);
  });

  it.each([false, null, "error"] as const)("cannot use relay to bypass follow status %s", async (status) => {
    if (status === "error") followStatus.mockRejectedValue(new Error("provider unavailable"));
    else followStatus.mockResolvedValue(status);
    await sendGift();
    expectNoGift();
  });

  it("cannot use relay to bypass email verification", async () => {
    unverified();
    await sendGift();
    expectNoGift();
  });

  it.each([false, true])("does not downgrade late SMTP SENT when relay throws (uncertain=%s)", async (uncertain) => {
    relaySend.mockImplementationOnce(async () => {
      // The HTTP endpoint has persisted acceptance, but its reply fails to reach
      // the worker. The worker's stale failure must not overwrite that receipt.
      claim.emailStatus = "SENT";
      claim.emailSentAt = new Date(NOW);
      throw new GiftMailError("late relay response", uncertain);
    });
    await sendGift();
    expect(claim.emailStatus).toBe("SENT");
    expect(claim.emailSentAt).toEqual(NOW);
    expect(claim.lastError).toBeNull();
    vi.setSystemTime(NOW.getTime() + 300_001);
    await sendGift();
    await reconcileGiftDeliveries();
    expect(relaySend).toHaveBeenCalledTimes(1);
    expect(instagramSend).toHaveBeenCalledTimes(1);
    expect(deliveryMail).not.toHaveBeenCalled();
    expect(queueAdd).not.toHaveBeenCalled();
  });

  it("retries a rejected relay with the next attempt without repeating IG", async () => {
    relaySend.mockRejectedValueOnce(new GiftMailError("relay rejected", false));
    await sendGift();
    expect(claim.emailStatus).toBe("FAILED");
    vi.setSystemTime(NOW.getTime() + 300_001);
    await sendGift();
    expect(relaySend).toHaveBeenNthCalledWith(1, "claim_test", 1);
    expect(relaySend).toHaveBeenNthCalledWith(2, "claim_test", 2);
    expect(instagramSend).toHaveBeenCalledTimes(1);
    expect(claim.emailStatus).toBe("SENT");
  });

  it("holds an uncertain relay result without silently switching to direct SMTP", async () => {
    relaySend.mockRejectedValueOnce(new GiftMailError("relay timed out", true));
    await sendGift();
    expect(claim.emailStatus).toBe("UNCONFIRMED");
    mailReady.mockReturnValue({ ready: true });
    relayReady.mockReturnValue(false);
    vi.setSystemTime(NOW.getTime() + 300_001);
    await sendGift();
    expect(relaySend).toHaveBeenCalledTimes(1);
    expect(deliveryMail).not.toHaveBeenCalled();
    expect(instagramSend).toHaveBeenCalledTimes(1);
  });
});

describe("gift verification requests", () => {
  beforeEach(unverified);

  it.each(["", "not-an-email", "a@b.test,b@c.test", "a@b.test\r\nBcc: b@c.test", `${"x".repeat(250)}@a.test`])("rejects malformed recipient %s without sending", async (email) => {
    await expect(requestGiftVerification({ token: accessToken(), email, marketingConsent: false })).rejects.toMatchObject({ status: 400 });
    expect(verificationMail).not.toHaveBeenCalled();
    expect(redisEval).not.toHaveBeenCalled();
  });

  it("normalizes the address, sends only a verification link, and never releases a gift", async () => {
    expect(normalizeGiftEmail(" Mixed@Recipient.Test ")).toBe("mixed@recipient.test");
    const result = await requestGiftVerification({ token: accessToken(), email: " New@Recipient.Test ", marketingConsent: false });
    expect(result).toEqual({ emailMasked: "n***@recipient.test" });
    expect(claim.email).toBe("new@recipient.test");
    expect(claim.emailVersion).toBe(2);
    expect(verificationMail).toHaveBeenCalledWith({ to: "new@recipient.test", verificationUrl: expect.stringContaining("https://gift-test.invalid/gift/verify?token="), deliveryKey: "verify-claim_test-2" });
    expect(JSON.stringify(verificationMail.mock.calls)).not.toMatch(/youtube|opaque-gift|PRIVATE_GIFT/);
    expectNoGift();
    expect(queueAdd).not.toHaveBeenCalled();
  });

  it("enforces the per-claim cooldown before another email is sent", async () => {
    claim.verificationSentAt = new Date(NOW.getTime() - 30_000);
    await expect(requestGiftVerification({ token: accessToken(), email: "recipient@recipient.test", marketingConsent: false })).rejects.toMatchObject({ status: 429 });
    expect(verificationMail).not.toHaveBeenCalled();
  });

  it("caps claim verification sends at five per day", async () => {
    claim.verificationCount = 5;
    await expect(requestGiftVerification({ token: accessToken(), email: "recipient@recipient.test", marketingConsent: false })).rejects.toMatchObject({ status: 429 });
    expect(verificationMail).not.toHaveBeenCalled();
    expect(redisEval).not.toHaveBeenCalled();
  });

  it("caps the same email across different claims", async () => {
    redisEval.mockResolvedValue(6);
    await expect(requestGiftVerification({ token: accessToken(), email: "recipient@recipient.test", marketingConsent: false })).rejects.toMatchObject({ status: 429 });
    expect(verificationMail).not.toHaveBeenCalled();
    expect(claim.emailVersion).toBe(1);
  });

  it("fails closed if the cross-claim abuse counter is unavailable", async () => {
    redisEval.mockRejectedValue(new Error("redis unavailable"));
    await expect(requestGiftVerification({ token: accessToken(), email: "recipient@recipient.test", marketingConsent: false })).rejects.toThrow();
    expect(verificationMail).not.toHaveBeenCalled();
  });

  it("resets a previous day's count without losing the current request", async () => {
    claim.verificationCount = 5;
    claim.verificationWindowStart = new Date(NOW.getTime() - DAY - 1);
    await requestGiftVerification({ token: accessToken(), email: "recipient@recipient.test", marketingConsent: false });
    expect(claim.verificationCount).toBe(1);
    expect(verificationMail).toHaveBeenCalledTimes(1);
  });

  it("two concurrent requests allow only one email version to be sent", async () => {
    const args = { token: accessToken(), email: "recipient@recipient.test", marketingConsent: false };
    const results = await Promise.allSettled([requestGiftVerification(args), requestGiftVerification(args)]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(verificationMail).toHaveBeenCalledTimes(1);
    expect(claim.emailVersion).toBe(2);
  });
});

describe("email token versioning and replay", () => {
  beforeEach(unverified);

  it("consumes a matching token once and queues delivery without sending synchronously", async () => {
    await expect(confirmGiftEmail(verificationToken)).resolves.toEqual({ verified: true });
    expect(claim.emailVerifiedAt).toEqual(NOW);
    expect(claim.verificationTokenHash).toBeNull();
    expect(db.giftContact.upsert).toHaveBeenCalledTimes(1);
    expect(queueAdd).toHaveBeenCalledTimes(1);
    expectNoGift();
    await expect(confirmGiftEmail(verificationToken)).rejects.toMatchObject({ status: 410 });
    expect(queueAdd).toHaveBeenCalledTimes(1);
  });

  it("changing the email invalidates the old link and confirms only the new recipient", async () => {
    await requestGiftVerification({ token: accessToken(), email: "new@recipient.test", marketingConsent: true });
    const url = new URL(verificationMail.mock.calls[0][0].verificationUrl);
    const replacementToken = url.searchParams.get("token")!;
    expect(replacementToken).not.toBe(verificationToken);
    await expect(confirmGiftEmail(verificationToken)).rejects.toMatchObject({ status: 410 });
    expect(db.giftContact.upsert).not.toHaveBeenCalled();
    await confirmGiftEmail(replacementToken);
    expect(db.giftContact.upsert).toHaveBeenCalledWith(expect.objectContaining({ create: expect.objectContaining({ email: "new@recipient.test" }) }));
    expect(queueAdd).toHaveBeenCalledTimes(1);
  });

  it("rejects a token whose email version changes between read and confirmation", async () => {
    const update = db.giftClaim.updateMany.getMockImplementation()!;
    db.giftClaim.updateMany.mockImplementationOnce(async (args) => {
      claim.emailVersion += 1;
      claim.verificationTokenHash = giftTokenHash("B".repeat(43));
      return update(args);
    });
    await expect(confirmGiftEmail(verificationToken)).rejects.toMatchObject({ status: 409 });
    expect(claim.emailVerifiedAt).toBeNull();
    expect(db.giftContact.upsert).not.toHaveBeenCalled();
    expect(queueAdd).not.toHaveBeenCalled();
  });

  it("only one concurrent confirmation consumes the token", async () => {
    const results = await Promise.allSettled([confirmGiftEmail(verificationToken), confirmGiftEmail(verificationToken)]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(db.giftContact.upsert).toHaveBeenCalledTimes(1);
    expect(queueAdd).toHaveBeenCalledTimes(1);
  });

  it("expired verification tokens cannot unlock either channel", async () => {
    claim.verificationExpiresAt = new Date(NOW);
    await expect(confirmGiftEmail(verificationToken)).rejects.toMatchObject({ status: 410 });
    expect(queueAdd).not.toHaveBeenCalled();
    await sendGift();
    expectNoGift();
  });

  it("retains verified state when queueing fails so reconciliation can recover", async () => {
    queueAdd.mockRejectedValueOnce(new Error("redis offline"));
    await expect(confirmGiftEmail(verificationToken)).resolves.toEqual({ verified: true });
    expect(claim.emailVerifiedAt).toEqual(NOW);
    await reconcileGiftDeliveries();
    expect(queueAdd).toHaveBeenCalledTimes(2);
    expectNoGift();
  });
});

describe("durable delivery reconciliation", () => {
  it("skips fifty older inactive claims so an active claim can enter the batch", async () => {
    const inactive = Array.from({ length: 50 }, (_, index) => {
      const row = freshClaim();
      row.id = `inactive_${index}`;
      row.automation.isActive = false;
      row.nextAttemptAt = new Date(NOW.getTime() - 60_000);
      return row;
    });
    db.giftClaim.findMany.mockImplementation(async ({ where, take }: { where: Row; take: number }) =>
      [...inactive, claim].filter((row) => matches(row as unknown as Row, where))
        .sort((left, right) => left.nextAttemptAt.getTime() - right.nextAttemptAt.getTime())
        .slice(0, take).map(({ id }) => ({ id })));
    await expect(reconcileGiftDeliveries()).resolves.toBe(1);
    expect(queueAdd).toHaveBeenCalledExactlyOnceWith("process-gift-claim", { claimId: "claim_test" }, expect.any(Object));
    expectNoGift();
  });

  it.each(["ig", "email"])("does not replay %s when external success cannot be persisted", async (channel) => {
    const update = db.giftClaim.updateMany.getMockImplementation()!;
    let persistenceFailed = false;
    db.giftClaim.updateMany.mockImplementation(async (args) => {
      if (!persistenceFailed && (channel === "ig" ? args.data.igStatus : args.data.emailStatus) === "SENT") {
        persistenceFailed = true;
        throw new Error("database unavailable after provider acceptance");
      }
      return update(args);
    });
    await sendGift();
    expect(channel === "ig" ? claim.igStatus : claim.emailStatus).toBe("SENDING");
    expect(claim.leaseUntil).not.toBeNull();
    vi.setSystemTime(NOW.getTime() + 600_001);
    await reconcileGiftDeliveries();
    expect(channel === "ig" ? claim.igStatus : claim.emailStatus).toBe("UNCONFIRMED");
    await sendGift();
    expect(instagramSend).toHaveBeenCalledTimes(1);
    expect(deliveryMail).toHaveBeenCalledTimes(1);
  });

  it("classifies an expired in-flight send as uncertain and only schedules its untouched channel", async () => {
    claim.igStatus = "SENDING";
    claim.leaseId = "crashed_worker";
    claim.leaseUntil = new Date(NOW.getTime() - 1);
    await reconcileGiftDeliveries();
    expect(claim.igStatus).toBe("UNCONFIRMED");
    expect(queueAdd).toHaveBeenCalledTimes(1);
    await sendGift();
    expect(instagramSend).not.toHaveBeenCalled();
    expect(deliveryMail).toHaveBeenCalledTimes(1);
  });

  it("never queues unverified claims or exhausted/uncertain channels", async () => {
    unverified();
    await reconcileGiftDeliveries();
    expect(queueAdd).not.toHaveBeenCalled();
    claim.emailVerifiedAt = new Date(NOW);
    claim.igStatus = "FAILED";
    claim.igAttempts = 3;
    claim.emailStatus = "UNCONFIRMED";
    await reconcileGiftDeliveries();
    expect(queueAdd).not.toHaveBeenCalled();
  });
});
