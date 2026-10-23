import { z } from "zod";
import { prisma } from "@/lib/db/client";
import { requireVerifiedEmail } from "@/lib/instagram/follow-policy";
import { TRACKED_LINK_ORDER } from "@/lib/tracking/link-order";
import { buildTrackedUrl } from "@/lib/tracking/message";
import { GiftMailError, getGiftMailConfiguration, sendGiftDeliveryEmail } from "@/lib/gifts/mailer";
import { giftPageUrl, signGiftAccess } from "@/lib/gifts/tokens";
import { GIFT_MAIL_RELAY_PROTOCOL, GIFT_MAIL_SIGNATURE_HEADER, GIFT_MAIL_TIMESTAMP_HEADER, verifyGiftMailRelaySignature } from "@/lib/gifts/mail-relay";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const bodySchema = z.object({ claimId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/), attempt: z.number().int().min(1).max(3) }).strict();
const claimInclude = {
  contact: true,
  automation: { include: { instagramAccount: true, trackedLinks: { orderBy: TRACKED_LINK_ORDER } } },
} as const;

function failure(status: number, deliveryUnconfirmed: boolean) {
  return Response.json({ protocol: GIFT_MAIL_RELAY_PROTOCOL, success: false, deliveryUnconfirmed,
    error: deliveryUnconfirmed ? "寄送結果尚未確認，請勿自動重寄。" : "寄送要求未被接受。" },
  { status, headers: { "Cache-Control": "no-store" } });
}
function success() {
  return Response.json({ protocol: GIFT_MAIL_RELAY_PROTOCOL, success: true, emailStatus: "SENT" },
    { headers: { "Cache-Control": "no-store" } });
}
function duplicate(error: unknown) {
  return error !== null && typeof error === "object" && "code" in error && error.code === "P2002";
}

// Signed, read-only configuration diagnostics. Never probes SMTP or touches claims.
export async function GET(request: Request) {
  if (!verifyGiftMailRelaySignature("", request.headers.get(GIFT_MAIL_TIMESTAMP_HEADER), request.headers.get(GIFT_MAIL_SIGNATURE_HEADER))) {
    return failure(401, false);
  }
  const configuration = getGiftMailConfiguration();
  return Response.json({
    protocol: GIFT_MAIL_RELAY_PROTOCOL,
    ready: configuration.ready,
    transport: configuration.transport,
    from: configuration.from,
    missing: configuration.missing,
  }, { headers: { "Cache-Control": "no-store" } });
}

// Only the authenticated worker can request delivery. Recipient and links never come from HTTP input.
export async function POST(request: Request) {
  try {
    const rawBody = await request.text();
    if (rawBody.length > 1024) return failure(413, false);
    if (!verifyGiftMailRelaySignature(rawBody, request.headers.get(GIFT_MAIL_TIMESTAMP_HEADER), request.headers.get(GIFT_MAIL_SIGNATURE_HEADER))) {
      return failure(401, false);
    }
    let parsed: z.infer<typeof bodySchema>;
    try { parsed = bodySchema.parse(JSON.parse(rawBody)); } catch { return failure(400, false); }
    const { claimId, attempt } = parsed;
    const operationId = `gift-mail:${claimId}:${attempt}`;
    const prior = await prisma.postbackDelivery.findUnique({ where: { id: operationId } });
    const claim = await prisma.giftClaim.findUnique({ where: { id: claimId }, include: claimInclude });
    if (claim?.emailAttempts === attempt && claim.emailStatus === "SENT") return success();
    // Check replay before mutable gates: an expired lease cannot make an in-flight send retryable.
    if (prior) return failure(409, true);
    const now = new Date();
    if (!claim?.email || !claim.emailVerifiedAt || !claim.contact || !claim.contact.emailVerifiedAt ||
      claim.contactId !== claim.contact.id || claim.contact.email !== claim.email ||
      claim.contact.workspaceId !== claim.workspaceId || claim.automation.workspaceId !== claim.workspaceId ||
      claim.automation.instagramAccount.workspaceId !== claim.workspaceId ||
      !claim.automation.isActive || !requireVerifiedEmail(claim.automation) ||
      !claim.followConfirmedAt || claim.expiresAt <= now ||
      claim.emailStatus !== "SENDING" || claim.emailAttempts !== attempt ||
      !claim.leaseId || !claim.leaseUntil || claim.leaseUntil <= now) {
      return failure(409, false);
    }
    if (!getGiftMailConfiguration().ready) return failure(503, false);
    const links = claim.automation.trackedLinks.map((link, index) => ({
      label: (index === 0 ? claim.automation.linkButtonLabel : link.label) || "領取禮物",
      url: buildTrackedUrl(link.slug),
    }));
    if (!links.length) return failure(409, false);
    const unsubscribeUrl = giftPageUrl("unsubscribe", signGiftAccess(claim.contact.id, "unsubscribe", new Date(Date.now() + 365 * 86_400_000)));
    try {
      // This durable unique marker is never deleted: even uncertain outcomes cannot be replayed.
      await prisma.postbackDelivery.create({ data: { id: operationId } });
    } catch (error) {
      if (!duplicate(error)) return failure(503, true);
      const current = await prisma.giftClaim.findUnique({ where: { id: claimId }, select: { emailAttempts: true, emailStatus: true } });
      return current?.emailAttempts === attempt && current.emailStatus === "SENT" ? success() : failure(409, true);
    }

    try {
      await sendGiftDeliveryEmail({ to: claim.email, links, unsubscribeUrl, deliveryKey: `gift-${claimId}` });
    } catch (error) {
      return failure(502, !(error instanceof GiftMailError) || error.deliveryUnconfirmed);
    }

    // SMTP can finish after the worker's HTTP timeout. Repair its UNCONFIRMED state
    // for this exact attempt/recipient version, never an unrelated newer delivery.
    const saved = await prisma.giftClaim.updateMany({ where: {
      id: claimId, emailAttempts: attempt, email: claim.email, emailVersion: claim.emailVersion,
      emailStatus: { in: ["SENDING", "UNCONFIRMED"] },
    }, data: { emailStatus: "SENT", emailSentAt: new Date() } });
    if (saved.count !== 1) {
      const current = await prisma.giftClaim.findUnique({ where: { id: claimId }, select: { emailAttempts: true, emailStatus: true, emailVersion: true, email: true } });
      if (current?.emailAttempts !== attempt || current.emailStatus !== "SENT" || current.emailVersion !== claim.emailVersion || current.email !== claim.email) {
        return failure(503, true);
      }
    }
    return success();
  } catch {
    // Never leak database/SMTP errors or claim contents; acceptance might already have happened.
    return failure(503, true);
  }
}
