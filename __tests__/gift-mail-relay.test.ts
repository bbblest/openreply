import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { db, sendEmail, mailConfiguration, fetchMock } = vi.hoisted(() => ({
  db: { giftClaim: { findUnique: vi.fn(), updateMany: vi.fn() }, postbackDelivery: { findUnique: vi.fn(), create: vi.fn() } },
  sendEmail: vi.fn(), mailConfiguration: vi.fn(), fetchMock: vi.fn(),
}));
vi.mock("@/lib/db/client", () => ({ prisma: db }));
vi.mock("@/lib/gifts/mailer", () => ({
  sendGiftDeliveryEmail: sendEmail, getGiftMailConfiguration: mailConfiguration,
  GiftMailError: class GiftMailError extends Error {
    constructor(message: string, public readonly deliveryUnconfirmed: boolean) { super(message); }
  },
}));
import { GET, POST } from "../app/api/internal/gift-mail/route";
import { GiftMailError } from "../lib/gifts/mailer";
import { isGiftMailRelayConfigured, relayGiftDeliveryEmail, verifyGiftMailRelaySignature } from "../lib/gifts/mail-relay";

const NOW = new Date("2026-10-23T03:00:00.000Z");
const secret = "test-only-shared-relay-secret";
function freshClaim() {
  return {
    id: "claim_test", workspaceId: "workspace_test", recipientId: "ig_test", email: "recipient@recipient.test",
    emailVerifiedAt: new Date(NOW), emailVersion: 1, contactId: "contact_test",
    followConfirmedAt: new Date(NOW), expiresAt: new Date(NOW.getTime() + 86_400_000),
    emailStatus: "SENDING", emailAttempts: 1, emailSentAt: null as Date | null,
    leaseId: "lease_test", leaseUntil: new Date(NOW.getTime() + 60_000),
    contact: { id: "contact_test", workspaceId: "workspace_test", email: "recipient@recipient.test", emailVerifiedAt: new Date(NOW) },
    automation: { id: "campaign_test", workspaceId: "workspace_test", requireEmail: true, isActive: true, linkButtonLabel: "領取禮物",
      instagramAccount: { workspaceId: "workspace_test" },
      trackedLinks: [{ slug: "gift_slug", label: "禮物", destinationUrl: "https://youtube.com/watch?v=gift" }] },
  };
}
let claim: ReturnType<typeof freshClaim>;
let markers: Set<string>;
function signature(rawBody: string, timestamp: string, signingSecret = secret) {
  return createHmac("sha256", signingSecret).update(`gift-mail-v1${timestamp}${rawBody}`).digest("hex");
}
function request(body: unknown = { claimId: "claim_test", attempt: 1 }, timestamp = String(NOW.getTime()), signingSecret = secret) {
  const rawBody = JSON.stringify(body);
  return new Request("https://gift-test.invalid/api/internal/gift-mail", { method: "POST", body: rawBody,
    headers: { "Content-Type": "application/json", "x-gift-mail-timestamp": timestamp, "x-gift-mail-signature": signature(rawBody, timestamp, signingSecret) } });
}
function diagnosticRequest(timestamp = String(NOW.getTime()), signingSecret = secret, signedBody = "") {
  return new Request("https://gift-test.invalid/api/internal/gift-mail", {
    headers: { "x-gift-mail-timestamp": timestamp, "x-gift-mail-signature": signature(signedBody, timestamp, signingSecret) },
  });
}
beforeEach(() => {
  vi.resetAllMocks(); vi.useFakeTimers(); vi.setSystemTime(NOW);
  vi.stubEnv("NEXTAUTH_SECRET", secret); vi.stubEnv("NEXTAUTH_URL", "https://gift-test.invalid");
  vi.stubEnv("GIFT_MAIL_RELAY", "true"); vi.stubEnv("REQUIRE_VERIFIED_EMAIL", "false");
  vi.stubGlobal("fetch", fetchMock);
  claim = freshClaim(); markers = new Set();
  mailConfiguration.mockReturnValue({ ready: true }); sendEmail.mockResolvedValue({ messageId: "mail_test" });
  db.giftClaim.findUnique.mockImplementation(async () => structuredClone(claim));
  db.postbackDelivery.findUnique.mockImplementation(async ({ where }: { where: { id: string } }) => markers.has(where.id) ? { id: where.id } : null);
  db.postbackDelivery.create.mockImplementation(async ({ data }: { data: { id: string } }) => {
    if (markers.has(data.id)) throw Object.assign(new Error("duplicate"), { code: "P2002" });
    markers.add(data.id); return { id: data.id };
  });
  db.giftClaim.updateMany.mockImplementation(async ({ where, data }: { where: { emailAttempts: number; email: string; emailVersion: number; emailStatus: { in: string[] } }; data: { emailStatus: string; emailSentAt: Date } }) => {
    if (claim.emailAttempts !== where.emailAttempts || claim.emailVersion !== where.emailVersion || claim.email !== where.email || !where.emailStatus.in.includes(claim.emailStatus)) return { count: 0 };
    Object.assign(claim, data); return { count: 1 };
  });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("signed read-only mail configuration diagnostics", () => {
  it("returns only safe configuration fields without sending or querying the database", async () => {
    mailConfiguration.mockReturnValue({ ready: true, transport: "smtp", from: "sender@sender.test", missing: [],
      server: "smtp://private-password@private-host", apiKey: "private-key" });
    const response = await GET(diagnosticRequest());
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual({ protocol: "gift-mail-v1", ready: true, transport: "smtp", from: "sender@sender.test", missing: [] });
    expect(sendEmail).not.toHaveBeenCalled();
    for (const model of Object.values(db)) for (const operation of Object.values(model)) expect(operation).not.toHaveBeenCalled();
  });
  it("reports missing configuration key names without treating it as a successful SMTP probe", async () => {
    mailConfiguration.mockReturnValue({ ready: false, transport: null, from: null, missing: ["GIFT_EMAIL_FROM or EMAIL_FROM"] });
    const response = await GET(diagnosticRequest());
    expect(await response.json()).toEqual({ protocol: "gift-mail-v1", ready: false, transport: null, from: null, missing: ["GIFT_EMAIL_FROM or EMAIL_FROM"] });
    expect(sendEmail).not.toHaveBeenCalled();
  });
  it.each(["incorrect-secret", ""])("rejects an invalid diagnostic signature: %s", async (key) => {
    expect((await GET(diagnosticRequest(undefined, key))).status).toBe(401);
    expect(mailConfiguration).not.toHaveBeenCalled(); expect(sendEmail).not.toHaveBeenCalled();
  });
  it.each([-60_001, 60_001])("rejects a stale or future diagnostic timestamp: %s", async (offset) => {
    expect((await GET(diagnosticRequest(String(NOW.getTime() + offset)))).status).toBe(401);
    expect(mailConfiguration).not.toHaveBeenCalled();
  });
  it("requires an empty signed body and rejects a missing signature", async () => {
    expect((await GET(diagnosticRequest(undefined, undefined, JSON.stringify({ claimId: claim.id, attempt: 1 })))).status).toBe(401);
    expect((await GET(new Request("https://gift-test.invalid/api/internal/gift-mail"))).status).toBe(401);
    expect(mailConfiguration).not.toHaveBeenCalled();
  });
});

describe("signed gift mail endpoint", () => {
  it.each(["wrong-secret", "", "short"])("does not allow an unauthenticated signer %s", async (key) => {
    const response = await POST(request(undefined, undefined, key));
    expect(response.status).toBe(401); expect(sendEmail).not.toHaveBeenCalled(); expect(db.giftClaim.findUnique).not.toHaveBeenCalled();
  });
  it.each([-60_001, 60_001])("rejects a timestamp outside the clock window %s", async (offset) => {
    const response = await POST(request(undefined, String(NOW.getTime() + offset)));
    expect(response.status).toBe(401); expect(sendEmail).not.toHaveBeenCalled();
  });
  it("signs the exact body and rejects extra recipient or link fields", async () => {
    expect(verifyGiftMailRelaySignature("changed", String(NOW.getTime()), signature("original", String(NOW.getTime())))).toBe(false);
    const response = await POST(request({ claimId: claim.id, attempt: 1, to: "injected@recipient.test", links: [{ url: "https://attacker.test" }] }));
    expect(response.status).toBe(400); expect(sendEmail).not.toHaveBeenCalled();
  });
  it("sends only database recipient/links and records provider acceptance", async () => {
    const response = await POST(request());
    expect(response.status).toBe(200); expect(await response.json()).toMatchObject({ success: true, emailStatus: "SENT" });
    expect(sendEmail).toHaveBeenCalledWith(expect.objectContaining({ to: "recipient@recipient.test", links: [{ label: "領取禮物", url: "https://gift-test.invalid/r/gift_slug" }], deliveryKey: "gift-claim_test", unsubscribeUrl: expect.stringContaining("https://gift-test.invalid/gift/unsubscribe?token=") }));
    expect(markers.has("gift-mail:claim_test:1")).toBe(true); expect(claim.emailStatus).toBe("SENT");
  });
  it("returns success for an already-sent replay without another message", async () => {
    await POST(request());
    const response = await POST(request());
    expect(response.status).toBe(200); expect(sendEmail).toHaveBeenCalledTimes(1);
  });
  it("blocks concurrent replay while the first send is outstanding", async () => {
    let release!: () => void;
    sendEmail.mockImplementation(() => new Promise<void>((resolve) => { release = resolve; }));
    const first = POST(request());
    await vi.waitFor(() => expect(sendEmail).toHaveBeenCalledOnce());
    const second = await POST(request());
    expect(second.status).toBe(409); expect(await second.json()).toMatchObject({ deliveryUnconfirmed: true });
    release(); expect((await first).status).toBe(200); expect(sendEmail).toHaveBeenCalledOnce();
  });
  it("treats replay as uncertain even when the lease has subsequently expired", async () => {
    markers.add("gift-mail:claim_test:1"); claim.leaseUntil = new Date(NOW.getTime() - 1);
    const response = await POST(request());
    expect(response.status).toBe(409); expect(await response.json()).toMatchObject({ deliveryUnconfirmed: true });
    expect(sendEmail).not.toHaveBeenCalled();
  });
  it.each([
    ["unverified email", (c: typeof claim) => { c.emailVerifiedAt = null as unknown as Date; }],
    ["unverified contact", (c: typeof claim) => { c.contact.emailVerifiedAt = null as unknown as Date; }],
    ["different contact email", (c: typeof claim) => { c.contact.email = "other@recipient.test"; }],
    ["different contact workspace", (c: typeof claim) => { c.contact.workspaceId = "other"; }],
    ["different campaign workspace", (c: typeof claim) => { c.automation.workspaceId = "other"; }],
    ["different IG workspace", (c: typeof claim) => { c.automation.instagramAccount.workspaceId = "other"; }],
    ["inactive campaign", (c: typeof claim) => { c.automation.isActive = false; }],
    ["email gate disabled", (c: typeof claim) => { c.automation.requireEmail = false; }],
    ["not sending", (c: typeof claim) => { c.emailStatus = "PENDING"; }],
    ["wrong attempt", (c: typeof claim) => { c.emailAttempts = 2; }],
    ["expired lease", (c: typeof claim) => { c.leaseUntil = new Date(NOW.getTime() - 1); }],
    ["expired claim", (c: typeof claim) => { c.expiresAt = new Date(NOW.getTime() - 1); }],
  ] as const)("withholds email for %s", async (_name, change) => {
    change(claim); const response = await POST(request());
    expect(response.status).toBe(409); expect(sendEmail).not.toHaveBeenCalled(); expect(markers.size).toBe(0);
  });
  it("retains the attempt marker on explicit SMTP rejection, allowing only a new attempt", async () => {
    sendEmail.mockRejectedValueOnce(new GiftMailError("rejected", false));
    const rejected = await POST(request());
    expect(await rejected.json()).toMatchObject({ deliveryUnconfirmed: false });
    expect((await POST(request())).status).toBe(409); expect(sendEmail).toHaveBeenCalledOnce();
    claim.emailAttempts = 2;
    expect((await POST(request({ claimId: claim.id, attempt: 2 }))).status).toBe(200);
    expect(sendEmail).toHaveBeenCalledTimes(2);
  });
  it("repairs a late SMTP success after the worker has marked that attempt unconfirmed", async () => {
    sendEmail.mockImplementation(async () => { claim.emailStatus = "UNCONFIRMED"; claim.leaseId = ""; return { messageId: "late" }; });
    expect((await POST(request())).status).toBe(200); expect(claim.emailStatus).toBe("SENT");
  });
  it("never acknowledges a newer attempt or recipient after the external send", async () => {
    sendEmail.mockImplementation(async () => { claim.emailAttempts = 2; claim.email = "new@recipient.test"; claim.emailVersion = 2; });
    const response = await POST(request());
    expect(response.status).toBe(503); expect(await response.json()).toMatchObject({ deliveryUnconfirmed: true });
    expect(claim.emailStatus).toBe("SENDING");
  });
  it("keeps the durable marker after external acceptance followed by a database failure", async () => {
    db.giftClaim.updateMany.mockRejectedValue(new Error("database private recipient@recipient.test"));
    const response = await POST(request()); const result = await response.json();
    expect(response.status).toBe(503); expect(result.deliveryUnconfirmed).toBe(true);
    expect(JSON.stringify(result)).not.toContain("recipient@");
    expect((await POST(request())).status).toBe(409); expect(sendEmail).toHaveBeenCalledOnce();
  });
  it("never returns raw SMTP errors", async () => {
    sendEmail.mockRejectedValue(new Error("recipient@recipient.test smtp-secret"));
    const response = await POST(request()); const result = await response.json();
    expect(result.deliveryUnconfirmed).toBe(true); expect(JSON.stringify(result)).not.toMatch(/recipient@|smtp-secret/);
  });
});

describe("worker mail relay client", () => {
  it("requires opt-in, a shared secret and an HTTPS app origin", () => {
    expect(isGiftMailRelayConfigured()).toBe(true);
    vi.stubEnv("GIFT_MAIL_RELAY", "false"); expect(isGiftMailRelayConfigured()).toBe(false);
    vi.stubEnv("GIFT_MAIL_RELAY", "true"); vi.stubEnv("NEXTAUTH_URL", "http://gift-test.invalid"); expect(isGiftMailRelayConfigured()).toBe(false);
    vi.stubEnv("NEXTAUTH_URL", "https://gift-test.invalid"); vi.stubEnv("NEXTAUTH_SECRET", "short"); expect(isGiftMailRelayConfigured()).toBe(false);
  });
  it("sends only claim/attempt in a timestamp-signed request and follows no redirects", async () => {
    fetchMock.mockResolvedValue(Response.json({ protocol: "gift-mail-v1", success: true, emailStatus: "SENT" }));
    await relayGiftDeliveryEmail(claim.id, 1);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe("https://gift-test.invalid/api/internal/gift-mail"); expect(JSON.parse(options.body)).toEqual({ claimId: claim.id, attempt: 1 });
    expect(verifyGiftMailRelaySignature(options.body, options.headers["x-gift-mail-timestamp"], options.headers["x-gift-mail-signature"])).toBe(true);
    expect(JSON.stringify(options)).not.toContain(secret); expect(options.redirect).toBe("error"); expect(options.signal).toBeInstanceOf(AbortSignal);
  });
  it("uses a relay-specific explicit not-sent response to distinguish rejection", async () => {
    fetchMock.mockResolvedValue(Response.json({ protocol: "gift-mail-v1", success: false, deliveryUnconfirmed: false }, { status: 409 }));
    await expect(relayGiftDeliveryEmail(claim.id, 1)).rejects.toMatchObject({ deliveryUnconfirmed: false });
  });
  it.each([409, 500, 502])("treats generic HTTP %s responses as uncertain", async (status) => {
    fetchMock.mockResolvedValue(Response.json({ deliveryUnconfirmed: false }, { status }));
    await expect(relayGiftDeliveryEmail(claim.id, 1)).rejects.toMatchObject({ deliveryUnconfirmed: true });
  });
  it("does not retry a timeout or expose its raw error", async () => {
    fetchMock.mockRejectedValue(new Error(`timeout ${secret}`));
    const error = await relayGiftDeliveryEmail(claim.id, 1).catch((value: unknown) => value);
    expect(error).toMatchObject({ deliveryUnconfirmed: true }); expect(String(error)).not.toContain(secret); expect(fetchMock).toHaveBeenCalledOnce();
  });
  it("does not report arbitrary HTTP 200 content as acceptance", async () => {
    fetchMock.mockResolvedValue(new Response("logged in", { status: 200 }));
    await expect(relayGiftDeliveryEmail(claim.id, 1)).rejects.toMatchObject({ deliveryUnconfirmed: true });
  });
});
