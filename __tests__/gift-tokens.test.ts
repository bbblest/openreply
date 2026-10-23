import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { giftPageUrl, giftTokenHash, randomGiftToken, readGiftAccess, signGiftAccess } from "@/lib/gifts/tokens";

describe("private gift links", () => {
  beforeEach(() => { vi.stubEnv("NEXTAUTH_SECRET", "test-only-gift-signing-key-at-least-32-characters"); vi.stubEnv("NEXTAUTH_URL", "https://gifts.example.test"); });
  afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); });
  it("rejects forgery, purpose confusion and expired tokens", () => {
    const token = signGiftAccess("claim-1", "claim", new Date(Date.now() + 60_000));
    expect(readGiftAccess(token, "claim")).toBe("claim-1");
    expect(readGiftAccess(token, "unsubscribe")).toBeNull();
    const [data, sig] = token.split(".");
    expect(readGiftAccess(`${data}.${sig[0] === "A" ? "B" : "A"}${sig.slice(1)}`, "claim")).toBeNull();
    const altered = Buffer.from(JSON.stringify({ id: "different", purpose: "claim", exp: Date.now() + 99999 })).toString("base64url");
    expect(readGiftAccess(`${altered}.${sig}`, "claim")).toBeNull();
    vi.useFakeTimers(); vi.setSystemTime(Date.now() + 61_000);
    expect(readGiftAccess(token, "claim")).toBeNull();
  });
  it("does not accept missing signing configuration", () => {
    vi.stubEnv("NEXTAUTH_SECRET", "");
    expect(() => signGiftAccess("id", "claim", new Date())).toThrow();
  });
  it("generates non-guessable verification values and stores only a stable hash", () => {
    const a = randomGiftToken(); const b = randomGiftToken();
    expect(a).toMatch(/^[\w-]{43}$/);
    expect(a).not.toBe(b);
    expect(giftTokenHash(a)).toMatch(/^[a-f0-9]{64}$/);
    expect(giftTokenHash(a)).not.toBe(a);
  });
  it("builds only configured first-party URLs without a gift destination", () => {
    const url = giftPageUrl("verify", "test-token");
    expect(url).toBe("https://gifts.example.test/gift/verify?token=test-token");
    vi.stubEnv("NEXTAUTH_URL", "https://secret:password@attacker.test");
    expect(() => giftPageUrl("claim", "x")).toThrow();
  });
});
