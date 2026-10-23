import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Prisma } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/db/client";
import { createInstagramContext, getUserFollowStatus, hasInstagramCredentials } from "@/lib/instagram/provider";
import { requireVerifiedEmail } from "@/lib/instagram/follow-policy";
import { isConfirmedSendRejection } from "@/lib/instagram/delivery-errors";
import { getDMQueue, getRedisConnection, GIFT_JOB_NAME } from "@/lib/queue/client";
import { TRACKED_LINK_ORDER } from "@/lib/tracking/link-order";
import { buildTrackedUrl } from "@/lib/tracking/message";
import { GiftMailError, getGiftMailConfiguration, sendGiftVerificationEmail, sendGiftDeliveryEmail } from "./mailer";
import { isGiftMailRelayConfigured, relayGiftDeliveryEmail } from "./mail-relay";
import { giftPageUrl, giftTokenHash, randomGiftToken, readGiftAccess, signGiftAccess } from "./tokens";

const DAY = 86_400_000;
const MINUTE = 60_000;
export class GiftClaimError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}
export type GiftDeliveryAutomation = Prisma.AutomationGetPayload<{ include: { instagramAccount: true; trackedLinks: true } }>;
export type GiftInstagramSender = (args: {
  claimId: string; automation: GiftDeliveryAutomation; recipientId: string; recipientName: string | null;
}) => Promise<void>;

function requireMailReady(allowRelay = false) {
  if (!getGiftMailConfiguration().ready && !(allowRelay && isGiftMailRelayConfigured())) {
    throw new GiftClaimError("寄信服務尚未準備好，請稍後再試。", 503);
  }
}
export function normalizeGiftEmail(email: string) {
  const parsed = z.string().trim().max(254).email().safeParse(email);
  if (!parsed.success || /[\r\n\x00-\x1f]/.test(email)) throw new GiftClaimError("請填寫一個有效的 Email。例：name@example.com");
  return parsed.data.toLowerCase();
}
export function maskGiftEmail(email: string | null) {
  if (!email) return null;
  const [local, domain] = email.split("@");
  return `${local.slice(0, 1)}***@${domain}`;
}
async function activeClaimByAccess(token: string) {
  const id = readGiftAccess(token, "claim");
  if (!id) throw new GiftClaimError("領取連結已失效，請回 IG 重新按「確認追蹤」。", 410);
  const claim = await prisma.giftClaim.findUnique({ where: { id }, include: { automation: true } });
  if (!claim || claim.expiresAt <= new Date() || !claim.automation.isActive || !requireVerifiedEmail(claim.automation)) {
    throw new GiftClaimError("領取連結已失效，請回 IG 重新領取。", 410);
  }
  return claim;
}

/** Called only after an explicit IG confirmation and a fresh successful follow lookup. */
export async function createGiftClaim(args: { automationId: string; recipientId: string; recipientName: string | null; followConfirmedAt: Date }) {
  requireMailReady(true);
  const automation = await prisma.automation.findUnique({ where: { id: args.automationId } });
  if (!automation?.isActive || !requireVerifiedEmail(automation)) throw new GiftClaimError("領取活動尚未啟用。", 409);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + DAY);
  // The unique campaign/IG pair survives duplicate postbacks and process restarts.
  const claim = await prisma.giftClaim.upsert({
    where: { automationId_recipientId: { automationId: automation.id, recipientId: args.recipientId } },
    create: { workspaceId: automation.workspaceId, automationId: automation.id, recipientId: args.recipientId,
      recipientName: args.recipientName, followConfirmedAt: args.followConfirmedAt, expiresAt },
    update: { recipientName: args.recipientName, followConfirmedAt: args.followConfirmedAt, expiresAt, nextAttemptAt: now },
  });
  if (claim.emailVerifiedAt) await enqueueGiftClaim(claim.id);
  return { claimId: claim.id, url: giftPageUrl("claim", signGiftAccess(claim.id, "claim", claim.expiresAt)) };
}

export async function getGiftClaimView(token: string) {
  const claim = await activeClaimByAccess(token);
  const complete = claim.igStatus === "SENT" && claim.emailStatus === "SENT";
  return { stage: complete ? "complete" : claim.emailVerifiedAt ? "ready" : claim.email ? "verify" : "email",
    emailMasked: maskGiftEmail(claim.email), igStatus: claim.igStatus, emailStatus: claim.emailStatus,
    notice: claim.lastError, verificationStatus: claim.verificationStatus };
}

export async function requestGiftVerification(args: { token: string; email: string; marketingConsent: boolean }) {
  const claim = await activeClaimByAccess(args.token);
  if (claim.emailVerifiedAt) throw new GiftClaimError("信箱已驗證，請等待禮物寄送。", 409);
  requireMailReady();
  const email = normalizeGiftEmail(args.email);
  const now = new Date();
  const elapsed = now.getTime() - (claim.verificationSentAt?.getTime() ?? 0);
  if (elapsed < MINUTE || (claim.verificationStatus === "SENDING" && elapsed < 2 * MINUTE)) {
    throw new GiftClaimError("驗證信正在處理，請稍後一分鐘再試。", 429);
  }
  const newWindow = now.getTime() - claim.verificationWindowStart.getTime() >= DAY;
  if (!newWindow && claim.verificationCount >= 5) throw new GiftClaimError("今天已寄出多次驗證信，請明天再試。", 429);
  // Limit a recipient across claims too; Redis failure fails closed, not open.
  const count = await getRedisConnection().eval(
    "local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],86400) end; return n", 1,
    `gift_email_verify:${giftTokenHash(email)}`,
  );
  if (Number(count) > 5) throw new GiftClaimError("此信箱今天已收到多次驗證信，請明天再試。", 429);
  const token = randomGiftToken();
  const changed = await prisma.giftClaim.updateMany({
    where: { id: claim.id, emailVersion: claim.emailVersion, emailVerifiedAt: null },
    data: { email, emailVersion: { increment: 1 }, verificationTokenHash: giftTokenHash(token),
      verificationExpiresAt: new Date(now.getTime() + 30 * MINUTE), verificationSentAt: now,
      verificationCount: newWindow ? 1 : { increment: 1 },
      ...(newWindow ? { verificationWindowStart: now } : {}), marketingConsent: args.marketingConsent,
      verificationStatus: "SENDING", lastError: null },
  });
  if (changed.count !== 1) throw new GiftClaimError("另一筆申請正在處理，請重新整理。", 409);
  try {
    await sendGiftVerificationEmail({ to: email, verificationUrl: giftPageUrl("verify", token),
      deliveryKey: `verify-${claim.id}-${claim.emailVersion + 1}` });
    await prisma.giftClaim.updateMany({ where: { id: claim.id, emailVersion: claim.emailVersion + 1 }, data: { verificationStatus: "SENT" } });
  } catch (error) {
    const uncertain = !(error instanceof GiftMailError) || error.deliveryUnconfirmed;
    await prisma.giftClaim.updateMany({ where: { id: claim.id, emailVersion: claim.emailVersion + 1 },
      data: { verificationStatus: uncertain ? "UNCONFIRMED" : "FAILED", lastError: uncertain ? "驗證信寄送結果待確認" : "驗證信寄送失敗" } });
    throw new GiftClaimError(uncertain ? "寄送結果尚未確認，請先查看收件匣與垃圾郵件，再稍後重試。" : "驗證信寄送失敗，請稍後重試。", 503);
  }
  return { emailMasked: maskGiftEmail(email) };
}

export async function confirmGiftEmail(token: string) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new GiftClaimError("驗證連結不正確。", 410);
  const hash = giftTokenHash(token);
  const now = new Date();
  const claim = await prisma.giftClaim.findUnique({ where: { verificationTokenHash: hash }, include: { automation: true } });
  if (!claim?.email || claim.emailVerifiedAt || !claim.verificationExpiresAt || claim.verificationExpiresAt <= now || claim.expiresAt <= now ||
    !claim.automation.isActive || !requireVerifiedEmail(claim.automation)) {
    throw new GiftClaimError("驗證連結已使用或已過期。請回 IG 的領取頁查看或重新申請。", 410);
  }
  await prisma.$transaction(async (tx) => {
    // Claim the exact email version/token before touching any contact consent.
    const updated = await tx.giftClaim.updateMany({ where: { id: claim.id, verificationTokenHash: hash, emailVerifiedAt: null, emailVersion: claim.emailVersion },
      data: { emailVerifiedAt: now, verificationTokenHash: null, nextAttemptAt: now } });
    if (updated.count !== 1) throw new GiftClaimError("驗證已完成或已更新，請回 IG 查看。", 409);
    const contact = await tx.giftContact.upsert({
      where: { workspaceId_email: { workspaceId: claim.workspaceId, email: claim.email! } },
      create: { workspaceId: claim.workspaceId, email: claim.email!, emailVerifiedAt: now,
        marketingConsentAt: claim.marketingConsent ? now : null },
      // A previously requested unsubscribe is never undone by an older claim.
      update: { emailVerifiedAt: now, ...(claim.marketingConsent ? { marketingConsentAt: now } : {}) },
    });
    await tx.giftClaim.update({ where: { id: claim.id }, data: { contactId: contact.id } });
  });
  // DB is the durable outbox. A Redis interruption is repaired by the worker sweep.
  await enqueueGiftClaim(claim.id).catch(() => {});
  return { verified: true };
}

export async function unsubscribeGiftContact(token: string) {
  const id = readGiftAccess(token, "unsubscribe");
  if (!id) throw new GiftClaimError("取消訂閱連結已失效。", 410);
  await prisma.giftContact.updateMany({ where: { id }, data: { unsubscribedAt: new Date() } });
  return { unsubscribed: true };
}

export async function enqueueGiftClaim(claimId: string) {
  return getDMQueue().add(GIFT_JOB_NAME, { claimId }, { jobId: `gift_${claimId}`, removeOnComplete: true, removeOnFail: true, attempts: 1 });
}

const retryableChannels = { OR: [
  { igStatus: { in: ["PENDING", "FAILED"] as ("PENDING" | "FAILED")[] }, igAttempts: { lt: 3 } },
  { emailStatus: { in: ["PENDING", "FAILED"] as ("PENDING" | "FAILED")[] }, emailAttempts: { lt: 3 } },
] };

export async function reconcileGiftDeliveries() {
  const now = new Date();
  // A process crash during a send is uncertain; never resend blindly.
  await prisma.giftClaim.updateMany({ where: { leaseUntil: { lt: now }, igStatus: "SENDING" },
    data: { igStatus: "UNCONFIRMED", lastError: "IG 傳送中斷，結果待人工確認" } });
  await prisma.giftClaim.updateMany({ where: { leaseUntil: { lt: now }, emailStatus: "SENDING" },
    data: { emailStatus: "UNCONFIRMED", lastError: "Email 寄送中斷，結果待人工確認" } });
  const rows = await prisma.giftClaim.findMany({ where: {
    emailVerifiedAt: { not: null }, expiresAt: { gt: now }, nextAttemptAt: { lte: now },
    automation: { isActive: true },
    AND: [retryableChannels, { OR: [{ leaseUntil: null }, { leaseUntil: { lt: now } }] }],
  }, select: { id: true }, take: 50, orderBy: { nextAttemptAt: "asc" } });
  for (const row of rows) await enqueueGiftClaim(row.id);
  return rows.length;
}

/** Independent channel statuses prevent replaying a successful IG send when SMTP fails. */
export async function processGiftDelivery(claimId: string, callbacks: { sendInstagramGift: GiftInstagramSender }) {
  const now = new Date();
  const leaseId = randomUUID();
  const locked = await prisma.giftClaim.updateMany({ where: { id: claimId, emailVerifiedAt: { not: null },
    email: { not: null }, contactId: { not: null }, expiresAt: { gt: now },
    OR: [{ leaseUntil: null }, { leaseUntil: { lt: now } }] },
    data: { leaseId, leaseUntil: new Date(now.getTime() + 10 * MINUTE) } });
  if (locked.count !== 1) return;
  try {
    const claim = await prisma.giftClaim.findUnique({ where: { id: claimId }, include: {
      contact: true, automation: { include: { instagramAccount: true, trackedLinks: { orderBy: TRACKED_LINK_ORDER } } },
    } });
    if (!claim?.emailVerifiedAt || !claim.email || !claim.contact?.emailVerifiedAt || claim.contact.email !== claim.email ||
      claim.contact.workspaceId !== claim.workspaceId || claim.automation.instagramAccount.workspaceId !== claim.workspaceId ||
      !claim.automation.isActive || claim.workspaceId !== claim.automation.workspaceId ||
      !requireVerifiedEmail(claim.automation) || !hasInstagramCredentials(claim.automation.instagramAccount)) {
      // Invalid rows must not occupy every due batch while their settings await repair.
      await prisma.giftClaim.updateMany({ where: { id: claimId, leaseId }, data: {
        lastError: "領取資料或活動設定待確認，寄送暫停。", nextAttemptAt: new Date(Date.now() + 30 * MINUTE),
      } });
      return;
    }
    const context = await createInstagramContext(claim.automation.instagramAccount, `gift-${claim.id}`);
    let follows: boolean | null = null;
    try { follows = await getUserFollowStatus({ context, recipientId: claim.recipientId }); } catch { /* unknown stays closed */ }
    if (follows !== true) {
      await prisma.giftClaim.update({ where: { id: claim.id }, data: {
        lastError: follows === false ? "尚未確認到追蹤，未完成的寄送暫停；請追蹤後回 IG 按「確認追蹤」。" : "追蹤狀態待確認，未完成的寄送暫停。",
        nextAttemptAt: new Date(Date.now() + 5 * MINUTE),
      } });
      return;
    }
    // No configurable content is used before both gates passed. A gift must have a destination.
    const links = claim.automation.trackedLinks.map((link, i) => ({
      label: (i === 0 ? claim.automation.linkButtonLabel : link.label) || "領取禮物", url: buildTrackedUrl(link.slug),
    }));
    if (!links.length) {
      await prisma.giftClaim.update({ where: { id: claim.id }, data: { lastError: "活動尚未設定禮物連結", nextAttemptAt: new Date(Date.now() + 30 * MINUTE) } });
      return;
    }
    requireMailReady(true);
    for (const channel of ["ig", "email"] as const) {
      const status = channel === "ig" ? claim.igStatus : claim.emailStatus;
      const attempts = channel === "ig" ? claim.igAttempts : claim.emailAttempts;
      if ((status !== "PENDING" && status !== "FAILED") || attempts >= 3) continue;
      const claimed = await prisma.giftClaim.updateMany({ where: { id: claim.id, leaseId,
        ...(channel === "ig" ? { igStatus: status, igAttempts: attempts } : { emailStatus: status, emailAttempts: attempts }) },
        data: channel === "ig" ? { igStatus: "SENDING", igAttempts: { increment: 1 } } : { emailStatus: "SENDING", emailAttempts: { increment: 1 } } });
      if (claimed.count !== 1) continue;
      try {
        if (channel === "ig") {
          await callbacks.sendInstagramGift({ claimId: claim.id, automation: claim.automation, recipientId: claim.recipientId, recipientName: claim.recipientName });
        } else if (isGiftMailRelayConfigured()) {
          await relayGiftDeliveryEmail(claim.id, attempts + 1);
        } else {
          const unsubscribeUrl = giftPageUrl("unsubscribe", signGiftAccess(claim.contactId!, "unsubscribe", new Date(Date.now() + 365 * DAY)));
          await sendGiftDeliveryEmail({ to: claim.email, links, unsubscribeUrl, deliveryKey: `gift-${claim.id}` });
        }
      } catch (error) {
        const uncertain = channel === "email"
          ? !(error instanceof GiftMailError) || error.deliveryUnconfirmed
          : !isConfirmedSendRejection(error);
        await prisma.giftClaim.updateMany({ where: { id: claim.id, leaseId,
          ...(channel === "ig" ? { igStatus: "SENDING", igAttempts: attempts + 1 } : { emailStatus: "SENDING", emailAttempts: attempts + 1 }),
        }, data: {
          ...(channel === "ig" ? { igStatus: uncertain ? "UNCONFIRMED" : "FAILED" } : { emailStatus: uncertain ? "UNCONFIRMED" : "FAILED" }),
          lastError: `${channel === "ig" ? "IG" : "Email"} ${uncertain ? "發送結果待確認，不會自動重送" : "發送失敗，稍後重試"}`,
          nextAttemptAt: new Date(Date.now() + 5 * MINUTE),
        } });
        continue;
      }
      // Keep SENDING if persistence fails after external success: sweep marks uncertain, never replay.
      await prisma.giftClaim.updateMany({ where: { id: claim.id, leaseId }, data: channel === "ig"
        ? { igStatus: "SENT", igSentAt: new Date() } : { emailStatus: "SENT", emailSentAt: new Date() } });
    }
    await prisma.giftClaim.updateMany({ where: { id: claim.id, leaseId, igStatus: "SENT", emailStatus: "SENT" },
      data: { lastError: null } });
  } catch {
    await prisma.giftClaim.updateMany({ where: { id: claimId, leaseId }, data: {
      lastError: "寄送作業暫時無法完成，請稍後查看狀態", nextAttemptAt: new Date(Date.now() + 5 * MINUTE),
    } });
  } finally {
    // If external sending or its acknowledgement crashed, retain the expiring
    // lease so reconciliation can classify SENDING as uncertain before retrying.
    await prisma.giftClaim.updateMany({ where: { id: claimId, leaseId, igStatus: { not: "SENDING" }, emailStatus: { not: "SENDING" } },
      data: { leaseId: null, leaseUntil: null } });
  }
}
