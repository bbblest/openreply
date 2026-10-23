import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

type Purpose = "claim" | "unsubscribe";
function key() {
  const value = process.env.NEXTAUTH_SECRET;
  if (!value || value.length < 16) throw new Error("領取連結簽章尚未設定");
  return value;
}
export function giftTokenHash(token: string) {
  return createHash("sha256").update(token).digest("hex");
}
export function randomGiftToken() { return randomBytes(32).toString("base64url"); }
export function signGiftAccess(id: string, purpose: Purpose, expiresAt: Date) {
  const data = Buffer.from(JSON.stringify({ id, purpose, exp: expiresAt.getTime() })).toString("base64url");
  const mac = createHmac("sha256", key()).update(`gift-v1.${data}`).digest("base64url");
  return `${data}.${mac}`;
}
export function readGiftAccess(token: string, purpose: Purpose): string | null {
  if (token.length > 1024 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) return null;
  const [data, signature] = token.split(".");
  const expected = createHmac("sha256", key()).update(`gift-v1.${data}`).digest();
  const actual = Buffer.from(signature, "base64url");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(data, "base64url").toString("utf8"));
    return parsed.purpose === purpose && typeof parsed.id === "string" &&
      parsed.id.length > 0 && parsed.id.length < 100 && Number.isSafeInteger(parsed.exp) &&
      parsed.exp > Date.now() ? parsed.id : null;
  } catch { return null; }
}
export function giftBaseUrl() {
  const raw = process.env.NEXTAUTH_URL;
  if (!raw) throw new Error("領取網站網址尚未設定");
  const url = new URL(raw);
  if ((url.protocol !== "https:" && !(process.env.NODE_ENV !== "production" && url.protocol === "http:")) || url.username || url.password) {
    throw new Error("領取網站網址設定不正確");
  }
  return url.origin;
}
export function giftPageUrl(path: "claim" | "verify" | "unsubscribe", token: string) {
  return `${giftBaseUrl()}/gift/${path}?token=${encodeURIComponent(token)}`;
}
