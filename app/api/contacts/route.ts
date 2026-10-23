import { NextRequest, NextResponse } from "next/server";
import { getCurrentWorkspaceContext, canManageWorkspace } from "@/lib/workspace-access";
import { prisma } from "@/lib/db/client";
import { csvCell } from "@/lib/gifts/csv";

export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
  const context = await getCurrentWorkspaceContext();
  if (!context) return NextResponse.json({ success: false, error: "請先登入。" }, { status: 401 });
  if (!canManageWorkspace(context.role)) return NextResponse.json({ success: false, error: "需要管理員權限才能查看 Email 名單。" }, { status: 403 });
  const contacts = await prisma.giftContact.findMany({ where: { workspaceId: context.workspaceId },
    include: { claims: { take: 1, orderBy: { createdAt: "desc" }, include: { automation: { select: { name: true } } } } },
    orderBy: { createdAt: "desc" }, take: 1000 });
  const pending = await prisma.giftClaim.findMany({ where: { workspaceId: context.workspaceId, email: { not: null }, emailVerifiedAt: null },
    include: { automation: { select: { name: true } } }, orderBy: { createdAt: "desc" }, take: 1000 });
  const verifiedRows = contacts.map((contact) => {
    const claim = contact.claims[0];
    return { id: contact.id, email: contact.email, instagramUsername: claim?.recipientName ?? claim?.recipientId ?? "",
      automationName: claim?.automation.name ?? "", emailVerifiedAt: contact.emailVerifiedAt,
      marketingConsent: Boolean(contact.marketingConsentAt) && !contact.unsubscribedAt,
      unsubscribedAt: contact.unsubscribedAt, igStatus: claim?.igStatus ?? "PENDING", emailStatus: claim?.emailStatus ?? "PENDING", createdAt: contact.createdAt };
  });
  const data = [...verifiedRows, ...pending.map((claim) => ({ id: `pending:${claim.id}`, email: claim.email!,
    instagramUsername: claim.recipientName ?? claim.recipientId, automationName: claim.automation.name,
    emailVerifiedAt: null, marketingConsent: false, unsubscribedAt: null, igStatus: claim.igStatus,
    emailStatus: claim.emailStatus, createdAt: claim.createdAt }))]
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).slice(0, 1000);
  if (request.nextUrl.searchParams.get("format") === "csv") {
    const headings = ["Email", "IG 帳號", "來源活動", "信箱驗證時間", "同意後續行銷", "取消訂閱時間", "IG 寄送狀態", "Email 寄送狀態", "建立時間"];
    const lines = data.map((row) => [row.email, row.instagramUsername, row.automationName, row.emailVerifiedAt?.toISOString() ?? "尚未確認",
      row.marketingConsent ? "是" : "否", row.unsubscribedAt?.toISOString() ?? "", row.igStatus, row.emailStatus, row.createdAt.toISOString()].map(csvCell).join(","));
    return new NextResponse(`\uFEFF${headings.map(csvCell).join(",")}\r\n${lines.join("\r\n")}`, {
      headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="email-contacts.csv"', "Cache-Control": "no-store" },
    });
  }
  return NextResponse.json({ success: true, data, limit: 1000 }, { headers: { "Cache-Control": "no-store" } });
}
