import { createHmac, timingSafeEqual } from "node:crypto";
import { GiftMailError } from "./mailer";

export const GIFT_MAIL_RELAY_PROTOCOL = "gift-mail-v1";
export const GIFT_MAIL_TIMESTAMP_HEADER = "x-gift-mail-timestamp";
export const GIFT_MAIL_SIGNATURE_HEADER = "x-gift-mail-signature";

function relaySecret(): string | null {
  const secret = process.env.NEXTAUTH_SECRET;
  return secret && secret.trim().length >= 16 ? secret : null;
}

function relayEndpoint(): string | null {
  try {
    const url = new URL(process.env.NEXTAUTH_URL ?? "");
    if (url.protocol !== "https:" || url.username || url.password) return null;
    return new URL("/api/internal/gift-mail", url.origin).href;
  } catch { return null; }
}

export function isGiftMailRelayConfigured(): boolean {
  return process.env.GIFT_MAIL_RELAY === "true" && Boolean(relaySecret() && relayEndpoint());
}

/** The timestamp and exact HTTP body are signed; parse JSON only after this check. */
export function verifyGiftMailRelaySignature(rawBody: string, timestamp: string | null, signature: string | null): boolean {
  const secret = relaySecret();
  if (!secret || !timestamp || !signature || !/^\d{13}$/.test(timestamp) || !/^[a-f0-9]{64}$/.test(signature)) return false;
  if (Math.abs(Date.now() - Number(timestamp)) > 60_000) return false;
  const expected = createHmac("sha256", secret).update(`${GIFT_MAIL_RELAY_PROTOCOL}${timestamp}${rawBody}`).digest();
  const provided = Buffer.from(signature, "hex");
  return provided.length === expected.length && timingSafeEqual(provided, expected);
}

export async function relayGiftDeliveryEmail(claimId: string, attempt: number): Promise<void> {
  const endpoint = relayEndpoint();
  const secret = relaySecret();
  if (!isGiftMailRelayConfigured() || !endpoint || !secret) {
    throw new GiftMailError("禮物郵件轉送服務尚未設定，尚未寄出。", false);
  }
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(claimId) || !Number.isInteger(attempt) || attempt < 1 || attempt > 3) {
    throw new GiftMailError("禮物郵件轉送資料不正確，尚未寄出。", false);
  }
  const rawBody = JSON.stringify({ claimId, attempt });
  const timestamp = String(Date.now());
  const signature = createHmac("sha256", secret).update(`${GIFT_MAIL_RELAY_PROTOCOL}${timestamp}${rawBody}`).digest("hex");
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", [GIFT_MAIL_TIMESTAMP_HEADER]: timestamp, [GIFT_MAIL_SIGNATURE_HEADER]: signature },
      body: rawBody,
      signal: AbortSignal.timeout(20_000),
      redirect: "error",
    });
    let result: unknown;
    try { result = await response.json(); } catch { result = null; }
    if (result && typeof result === "object" && "protocol" in result && result.protocol === GIFT_MAIL_RELAY_PROTOCOL) {
      const data = result as { success?: unknown; emailStatus?: unknown; deliveryUnconfirmed?: unknown };
      if (response.ok && data.success === true && data.emailStatus === "SENT") return;
      if (!response.ok && data.success === false && data.deliveryUnconfirmed === false) {
        throw new GiftMailError("禮物郵件轉送未被接受，尚未寄出。", false);
      }
    }
    throw new GiftMailError("禮物郵件寄送結果尚未確認，已停止自動重寄。", true);
  } catch (error) {
    if (error instanceof GiftMailError) throw error;
    throw new GiftMailError("禮物郵件寄送結果尚未確認，已停止自動重寄。", true);
  }
}
