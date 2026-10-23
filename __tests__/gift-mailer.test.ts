import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { sendMail, close, createTransport, fetchMock } = vi.hoisted(() => ({
  sendMail: vi.fn(), close: vi.fn(), createTransport: vi.fn(), fetchMock: vi.fn(),
}));
vi.mock("nodemailer", () => ({ default: { createTransport } }));

import { GiftMailError, getGiftMailConfiguration, sendGiftDeliveryEmail, sendGiftVerificationEmail } from "../lib/gifts/mailer";

const recipient = "recipient@recipient.test";
const verificationUrl = "https://brand.test/gifts/verify?token=opaque&claim=claim-1";
const links = [{ label: "領取禮物", url: "https://www.youtube.com/watch?v=test-gift" }];

beforeEach(() => {
  vi.resetAllMocks();
  for (const name of ["GIFT_EMAIL_FROM", "EMAIL_FROM", "GIFT_EMAIL_SERVER", "EMAIL_SERVER", "GIFT_RESEND_API_KEY", "RESEND_API_KEY"]) {
    vi.stubEnv(name, undefined);
  }
  vi.stubGlobal("fetch", fetchMock);
  createTransport.mockReturnValue({ sendMail, close });
  sendMail.mockResolvedValue({ accepted: [recipient], rejected: [], messageId: "smtp-message-1" });
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

function useSmtp() {
  vi.stubEnv("EMAIL_FROM", "徐三代 <yes@good01.tw>");
  vi.stubEnv("EMAIL_SERVER", "smtps://sender%40brand.test:secret-password@mail.brand.test:465");
}
function useResend() {
  vi.stubEnv("EMAIL_FROM", "徐三代 <yes@good01.tw>");
  vi.stubEnv("RESEND_API_KEY", "secret-api-key");
  fetchMock.mockResolvedValue(new Response(JSON.stringify({ id: "resend-message-1" }), { status: 200 }));
}

describe("gift email configuration", () => {
  it("does not invent a sender when configuration is absent", () => {
    expect(getGiftMailConfiguration()).toMatchObject({ ready: false, from: null, transport: null });
    expect(createTransport).not.toHaveBeenCalled();
  });
  it.each(["login@example.com", "OpenReply <login@example.com>", "login@mail.example.com", "other@brand.test, Sender <gift@brand.test>", "bad\r\nBcc: hidden@brand.test"])("rejects placeholder or injected sender %s", (from) => {
    useSmtp(); vi.stubEnv("EMAIL_FROM", from);
    expect(getGiftMailConfiguration().ready).toBe(false);
  });
  it("uses gift-specific configuration without exposing credentials", () => {
    useSmtp();
    vi.stubEnv("GIFT_EMAIL_FROM", "禮物 <gift@brand.test>");
    vi.stubEnv("GIFT_EMAIL_SERVER", "smtp://gift:gift-password@mail.brand.test:587");
    expect(getGiftMailConfiguration()).toEqual({ ready: true, from: "禮物 <gift@brand.test>", transport: "smtp", missing: [] });
    expect(JSON.stringify(getGiftMailConfiguration())).not.toContain("password");
  });
  it("does not fall back when an explicit gift sender is empty", () => {
    useSmtp(); vi.stubEnv("GIFT_EMAIL_FROM", "");
    expect(getGiftMailConfiguration().ready).toBe(false);
  });
  it.each(["https://smtp.brand.test", "smtp://user:pass@mail.brand.test?debug=true", "not-a-url"])("rejects unsupported SMTP configuration %s", (server) => {
    useSmtp(); vi.stubEnv("EMAIL_SERVER", server); vi.stubEnv("RESEND_API_KEY", "unused-key");
    expect(getGiftMailConfiguration().ready).toBe(false);
  });
});

describe("gift email content and SMTP delivery", () => {
  it("verification sends only the confirmation URL, never the gift", async () => {
    useSmtp();
    expect(await sendGiftVerificationEmail({ to: recipient, verificationUrl })).toEqual({ messageId: "smtp-message-1" });
    const message = sendMail.mock.calls[0][0];
    expect(message.subject).toContain("確認信箱");
    expect(message.text).toContain(verificationUrl);
    expect(message.html).toContain("token=opaque&amp;claim=claim-1");
    expect(JSON.stringify(message)).not.toMatch(/youtube|test-gift/i);
    expect(close).toHaveBeenCalledOnce();
  });
  it("sends escaped HTML, buttons and plain-text gift URLs with optional unsubscribe", async () => {
    useSmtp();
    await sendGiftDeliveryEmail({ to: recipient, links: [{ label: '<img src=x onerror="bad"> & 禮物', url: "https://brand.test/gift?a=1&b=2" }], unsubscribeUrl: "https://brand.test/unsubscribe?token=x&kind=marketing" });
    const message = sendMail.mock.calls[0][0];
    expect(message.text).toContain("https://brand.test/gift?a=1&b=2");
    expect(message.html).toContain("&lt;img src=x onerror=&quot;bad&quot;&gt; &amp; 禮物");
    expect(message.html).not.toContain("<img");
    expect(message.html).toContain('href="https://brand.test/gift?a=1&amp;b=2"');
    expect(message.html).toContain("取消訂閱");
  });
  it("enables TLS and bounded timeouts while suppressing transport logs", async () => {
    useSmtp(); vi.stubEnv("EMAIL_SERVER", "smtp://user:pass@mail.brand.test:587");
    await sendGiftDeliveryEmail({ to: recipient, links });
    expect(createTransport).toHaveBeenCalledWith(expect.objectContaining({ secure: false, requireTLS: true, connectionTimeout: 10_000, socketTimeout: 20_000, logger: false, debug: false }));
  });
  it("uses a stable Message-ID for an operation and separates verification from delivery", async () => {
    useSmtp();
    await sendGiftVerificationEmail({ to: recipient, verificationUrl, deliveryKey: "claim-1" });
    await sendGiftVerificationEmail({ to: recipient, verificationUrl, deliveryKey: "claim-1" });
    await sendGiftDeliveryEmail({ to: recipient, links, deliveryKey: "claim-1" });
    expect(sendMail.mock.calls[0][0].messageId).toEqual(sendMail.mock.calls[1][0].messageId);
    expect(sendMail.mock.calls[0][0].messageId).not.toEqual(sendMail.mock.calls[2][0].messageId);
    expect(sendMail.mock.calls[0][0].messageId).not.toContain("claim-1");
  });
  it.each(["javascript:alert(1)", "file:///private", "https://user:pass@brand.test/gift"])("refuses unsafe gift URL %s without sending", async (url) => {
    useSmtp();
    await expect(sendGiftDeliveryEmail({ to: recipient, links: [{ label: "gift", url }] })).rejects.toMatchObject({ deliveryUnconfirmed: false });
    expect(sendMail).not.toHaveBeenCalled(); expect(fetchMock).not.toHaveBeenCalled();
  });
  it("refuses malformed recipients, missing links and unconfigured mail before sending", async () => {
    await expect(sendGiftVerificationEmail({ to: recipient, verificationUrl })).rejects.toMatchObject({ deliveryUnconfirmed: false });
    useSmtp();
    await expect(sendGiftDeliveryEmail({ to: "victim@brand.test\r\nBcc: hidden@brand.test", links })).rejects.toMatchObject({ deliveryUnconfirmed: false });
    await expect(sendGiftDeliveryEmail({ to: recipient, links: [] })).rejects.toMatchObject({ deliveryUnconfirmed: false });
    expect(sendMail).not.toHaveBeenCalled();
  });
  it("classifies explicit SMTP rejection without exposing recipient or credentials", async () => {
    useSmtp();
    sendMail.mockRejectedValue(Object.assign(new Error(`${recipient} secret-password refused`), { responseCode: 550, command: "DATA" }));
    const error = await sendGiftDeliveryEmail({ to: recipient, links }).catch((value: unknown) => value);
    expect(error).toBeInstanceOf(GiftMailError);
    expect(error).toMatchObject({ deliveryUnconfirmed: false });
    expect(String(error)).not.toContain(recipient); expect(String(error)).not.toContain("secret-password");
    expect(close).toHaveBeenCalledOnce();
  });
  it.each([{ code: "ETIMEDOUT" }, { code: "ESOCKET" }, { responseCode: 550, command: "QUIT" }])("does not retry an uncertain SMTP outcome %j", async (details) => {
    useSmtp(); sendMail.mockRejectedValue(Object.assign(new Error("private remote detail"), details));
    await expect(sendGiftDeliveryEmail({ to: recipient, links })).rejects.toMatchObject({ deliveryUnconfirmed: true });
    expect(sendMail).toHaveBeenCalledOnce();
  });
  it("requires an explicit recipient acceptance and distinguishes rejection from missing result", async () => {
    useSmtp();
    sendMail.mockResolvedValueOnce({ accepted: [], rejected: [recipient] });
    await expect(sendGiftDeliveryEmail({ to: recipient, links })).rejects.toMatchObject({ deliveryUnconfirmed: false });
    sendMail.mockResolvedValueOnce({ accepted: [], rejected: [] });
    await expect(sendGiftDeliveryEmail({ to: recipient, links })).rejects.toMatchObject({ deliveryUnconfirmed: true });
  });
});

describe("Resend gift delivery", () => {
  it("sends via the API with a hashed idempotency key and a bounded request", async () => {
    useResend();
    const result = await sendGiftDeliveryEmail({ to: recipient, links, deliveryKey: "claim-1" });
    expect(result).toEqual({ messageId: "resend-message-1" });
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.resend.com/emails");
    expect(options.headers["Idempotency-Key"]).toMatch(/^gift-[a-f0-9]{64}$/);
    expect(options.headers["Idempotency-Key"]).not.toContain(recipient);
    expect(options.signal).toBeInstanceOf(AbortSignal);
    expect(options.redirect).toBe("error");
    expect(JSON.parse(options.body).to).toEqual([recipient]);
    expect(createTransport).not.toHaveBeenCalled();
  });
  it.each([400, 401, 422, 429])("treats explicit API refusal %s as not accepted", async (status) => {
    useResend(); fetchMock.mockResolvedValue(new Response(`${recipient} secret-api-key`, { status }));
    const error = await sendGiftDeliveryEmail({ to: recipient, links }).catch((value: unknown) => value);
    expect(error).toMatchObject({ deliveryUnconfirmed: false });
    expect(String(error)).not.toContain(recipient); expect(String(error)).not.toContain("secret-api-key");
  });
  it.each([408, 409, 500, 502])("stops automatic retry for uncertain API status %s", async (status) => {
    useResend(); fetchMock.mockResolvedValue(new Response("unknown", { status }));
    await expect(sendGiftDeliveryEmail({ to: recipient, links })).rejects.toMatchObject({ deliveryUnconfirmed: true });
    expect(fetchMock).toHaveBeenCalledOnce();
  });
  it.each(["not-json", "{}"])("treats an unusable success body %s as uncertain", async (body) => {
    useResend(); fetchMock.mockResolvedValue(new Response(body, { status: 200 }));
    await expect(sendGiftDeliveryEmail({ to: recipient, links })).rejects.toMatchObject({ deliveryUnconfirmed: true });
  });
  it("redacts a timeout and never retries on its own", async () => {
    useResend(); fetchMock.mockRejectedValue(new Error(`${recipient} secret-api-key timed out`));
    const error = await sendGiftDeliveryEmail({ to: recipient, links }).catch((value: unknown) => value);
    expect(error).toMatchObject({ deliveryUnconfirmed: true });
    expect(String(error)).not.toContain(recipient); expect(String(error)).not.toContain("secret-api-key");
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
