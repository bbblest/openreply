import { createHash } from "node:crypto";
import nodemailer from "nodemailer";
import type SMTPTransport from "nodemailer/lib/smtp-transport";
import { z } from "zod";

export class GiftMailError extends Error {
  constructor(message: string, public readonly deliveryUnconfirmed: boolean) {
    super(message);
    this.name = "GiftMailError";
  }
}

export interface GiftMailConfiguration {
  ready: boolean;
  from: string | null;
  transport: "smtp" | "resend" | null;
  missing: string[];
}

interface SendOptions {
  to: string;
  /** Persist this key before sending. SMTP Message-ID alone cannot prevent duplicates. */
  deliveryKey?: string;
}

export interface GiftMailResult {
  /** Provider acceptance does not prove that a message reached the recipient's inbox. */
  messageId: string | null;
}

const emailSchema = z.string().email().max(254);
const REQUEST_TIMEOUT_MS = 15_000;

function configuredValue(primary: string, fallback: string): string | undefined {
  // An explicitly empty override disables the fallback instead of silently using it.
  return (process.env[primary] ?? process.env[fallback])?.trim() || undefined;
}

function senderAddress(from: string | undefined): string | null {
  if (!from || /[\r\n]/.test(from)) return null;
  const mailbox = from.match(/^[^<>@,;]*<([^<>]+)>$/)?.[1] ?? from;
  const parsed = emailSchema.safeParse(mailbox.trim());
  if (!parsed.success) return null;
  const domain = parsed.data.split("@")[1].toLowerCase();
  if (/^(?:.+\.)?example\.(?:com|net|org)$/.test(domain)) return null;
  return parsed.data;
}

function smtpOptions(server: string): SMTPTransport.Options | null {
  try {
    const url = new URL(server);
    if (
      !["smtp:", "smtps:"].includes(url.protocol) ||
      !url.hostname ||
      (url.pathname && url.pathname !== "/") ||
      url.search || url.hash
    ) return null;
    const secure = url.protocol === "smtps:";
    return {
      host: url.hostname,
      port: url.port ? Number(url.port) : secure ? 465 : 587,
      secure,
      requireTLS: !secure,
      ...(url.username ? {
        auth: {
          user: decodeURIComponent(url.username),
          pass: decodeURIComponent(url.password),
        },
      } : {}),
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000,
      logger: false,
      debug: false,
      disableFileAccess: true,
      disableUrlAccess: true,
    };
  } catch {
    return null;
  }
}

export function getGiftMailConfiguration(): GiftMailConfiguration {
  const candidate = configuredValue("GIFT_EMAIL_FROM", "EMAIL_FROM");
  const from = senderAddress(candidate) ? candidate! : null;
  const server = configuredValue("GIFT_EMAIL_SERVER", "EMAIL_SERVER");
  const key = configuredValue("GIFT_RESEND_API_KEY", "RESEND_API_KEY");
  const transport = server ? "smtp" : key ? "resend" : null;
  const missing: string[] = [];
  if (!from) missing.push("GIFT_EMAIL_FROM / EMAIL_FROM");
  if (server && !smtpOptions(server)) missing.push("GIFT_EMAIL_SERVER / EMAIL_SERVER");
  if (!transport) missing.push("GIFT_EMAIL_SERVER / EMAIL_SERVER 或 GIFT_RESEND_API_KEY / RESEND_API_KEY");
  // Ready only means explicit configuration is present, not that the sender is verified.
  return { ready: missing.length === 0, from, transport, missing };
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]!);
}

function safeUrl(value: string): string {
  try {
    if (/[\r\n]/.test(value)) throw new Error();
    const url = new URL(value);
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) {
      throw new Error();
    }
    return url.href;
  } catch {
    throw new GiftMailError("郵件連結格式不正確，尚未寄出。", false);
  }
}

function button(label: string, url: string): string {
  return `<p><a href="${escapeHtml(url)}" style="display:inline-block;padding:12px 20px;background:#ea580c;color:#fff;border-radius:6px;text-decoration:none">${escapeHtml(label)}</a></p>`;
}

function htmlBody(content: string): string {
  return `<!doctype html><html lang="zh-Hant"><body style="font-family:Arial,sans-serif;line-height:1.7;color:#262626"><main style="max-width:600px;margin:auto;padding:24px">${content}</main></body></html>`;
}

function smtpRejected(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const value = error as { code?: string; responseCode?: number; command?: string };
  if (["ETIMEDOUT", "ESOCKET"].includes(value.code ?? "")) return false;
  if (["EAUTH", "EENVELOPE", "EDNS", "ENOTFOUND", "ECONNREFUSED"].includes(value.code ?? "")) return true;
  // A failed QUIT after DATA acceptance must not be treated as safe to resend.
  return typeof value.responseCode === "number" &&
    value.responseCode >= 400 && value.responseCode < 600 &&
    /^(?:AUTH(?: |$)|MAIL FROM|RCPT TO|DATA$)/i.test(value.command ?? "");
}

function containsRecipient(addresses: Array<string | { address: string }> | undefined, to: string) {
  return addresses?.some((entry) => (typeof entry === "string" ? entry : entry.address).toLowerCase() === to.toLowerCase()) ?? false;
}

async function sendMail({ to, deliveryKey, kind, subject, text, html }: SendOptions & {
  kind: "verification" | "delivery";
  subject: string;
  text: string;
  html: string;
}): Promise<GiftMailResult> {
  const recipient = emailSchema.safeParse(to.trim());
  if (!recipient.success || /[\r\n]/.test(to)) {
    throw new GiftMailError("收件信箱格式不正確，尚未寄出。", false);
  }
  const config = getGiftMailConfiguration();
  if (!config.ready || !config.from || !config.transport) {
    throw new GiftMailError("禮物郵件尚未完成寄件設定。", false);
  }
  const key = deliveryKey
    ? `gift-${createHash("sha256").update(`${kind}:${deliveryKey}`).digest("hex")}`
    : undefined;
  const message = { from: config.from, to: recipient.data, subject, text, html };

  if (config.transport === "smtp") {
    const options = smtpOptions(configuredValue("GIFT_EMAIL_SERVER", "EMAIL_SERVER")!);
    if (!options) throw new GiftMailError("禮物郵件尚未完成寄件設定。", false);
    let transporter: ReturnType<typeof nodemailer.createTransport>;
    try {
      transporter = nodemailer.createTransport(options);
    } catch {
      throw new GiftMailError("禮物郵件寄件設定無法使用，尚未寄出。", false);
    }
    try {
      const result = await transporter.sendMail({
        ...message,
        ...(key ? { messageId: `<${key}@${senderAddress(config.from)!.split("@")[1]}>` } : {}),
      });
      if (!containsRecipient(result.accepted, recipient.data)) {
        if (containsRecipient(result.rejected, recipient.data)) {
          throw new GiftMailError("寄信服務拒絕此次郵件，尚未送出。", false);
        }
        throw new GiftMailError("郵件寄送結果尚未確認，已停止自動重寄。", true);
      }
      return { messageId: typeof result.messageId === "string" ? result.messageId : null };
    } catch (error) {
      if (error instanceof GiftMailError) throw error;
      throw new GiftMailError(
        smtpRejected(error)
          ? "寄信服務拒絕此次郵件，尚未送出。"
          : "郵件寄送結果尚未確認，已停止自動重寄。",
        !smtpRejected(error),
      );
    } finally {
      try { transporter.close(); } catch { /* Closing cannot change acceptance. */ }
    }
  }

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${configuredValue("GIFT_RESEND_API_KEY", "RESEND_API_KEY")}`,
        "Content-Type": "application/json",
        ...(key ? { "Idempotency-Key": key } : {}),
      },
      body: JSON.stringify({ ...message, to: [recipient.data] }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      redirect: "error",
    });
    if (!response.ok) {
      // Timeouts, in-progress/conflicting idempotency requests and server errors
      // may follow acceptance. Never include provider error bodies in errors.
      const rejected = response.status >= 400 && response.status < 500 &&
        ![408, 409].includes(response.status);
      throw new GiftMailError(
        rejected ? "寄信服務拒絕此次郵件，尚未送出。" : "郵件寄送結果尚未確認，已停止自動重寄。",
        !rejected,
      );
    }
    const result: unknown = await response.json();
    if (!result || typeof result !== "object" || !("id" in result) || typeof result.id !== "string" || !result.id) {
      throw new GiftMailError("郵件寄送結果尚未確認，已停止自動重寄。", true);
    }
    return { messageId: result.id };
  } catch (error) {
    if (error instanceof GiftMailError) throw error;
    throw new GiftMailError("郵件寄送結果尚未確認，已停止自動重寄。", true);
  }
}

export async function sendGiftVerificationEmail({ to, verificationUrl, deliveryKey }: SendOptions & {
  verificationUrl: string;
}): Promise<GiftMailResult> {
  const url = safeUrl(verificationUrl);
  return sendMail({
    to, deliveryKey, kind: "verification", subject: "請確認信箱，領取你的專屬禮物",
    text: `請按下連結確認這是你的信箱，完成後即可繼續領取專屬禮物：\n${url}\n\n若你沒有申請領取，請忽略這封信。`,
    html: htmlBody(`<h1>確認你的電子郵件信箱</h1><p>請按下方按鈕確認這是你的信箱，完成後即可繼續領取專屬禮物。</p>${button("確認信箱", url)}<p>若無法點按鈕，請複製下方網址到瀏覽器：</p><p>${escapeHtml(url)}</p><p>若你沒有申請領取，請忽略這封信。</p>`),
  });
}

export async function sendGiftDeliveryEmail({ to, links, unsubscribeUrl, deliveryKey }: SendOptions & {
  links: Array<{ label: string; url: string }>;
  unsubscribeUrl?: string;
}): Promise<GiftMailResult> {
  if (!links.length) throw new GiftMailError("尚未設定禮物連結，郵件尚未寄出。", false);
  const safeLinks = links.map((link) => ({ label: link.label.trim() || "領取禮物", url: safeUrl(link.url) }));
  const unsubscribe = unsubscribeUrl ? safeUrl(unsubscribeUrl) : null;
  return sendMail({
    to, deliveryKey, kind: "delivery", subject: "你的專屬禮物已準備好",
    text: `感謝你的支持！以下是你申請領取的專屬禮物：\n\n${safeLinks.map((link) => `${link.label}\n${link.url}`).join("\n\n")}\n\n請妥善保存這封信。${unsubscribe ? `\n\n若不想收到後續行銷郵件，可在此取消訂閱：\n${unsubscribe}` : ""}`,
    html: htmlBody(`<h1>你的專屬禮物</h1><p>感謝你的支持！以下是你申請領取的禮物，請點按鈕開啟：</p>${safeLinks.map((link) => `${button(link.label, link.url)}<p>${escapeHtml(link.url)}</p>`).join("")}<p>請妥善保存這封信。</p>${unsubscribe ? `<p>若不想收到後續行銷郵件，可<a href="${escapeHtml(unsubscribe)}">取消訂閱</a>。</p>` : ""}`),
  });
}
