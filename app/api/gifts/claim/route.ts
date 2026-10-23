import { NextRequest } from "next/server";
import { z } from "zod";
import { GiftClaimError, getGiftClaimView, requestGiftVerification } from "@/lib/gifts/claims";
import { giftError, giftJson, giftRequestBody } from "@/lib/gifts/http";

export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
  try {
    return giftJson({ success: true, data: await getGiftClaimView(request.nextUrl.searchParams.get("token") ?? "") });
  } catch (error) { return giftError(error); }
}
export async function POST(request: NextRequest) {
  try {
    const parsed = z.object({ token: z.string().min(1).max(1024), email: z.string().max(254), marketingConsent: z.boolean().default(false) })
      .safeParse(await giftRequestBody(request));
    if (!parsed.success) throw new GiftClaimError("請填寫有效 Email，並確認領取連結。");
    return giftJson({ success: true, data: await requestGiftVerification(parsed.data) });
  } catch (error) { return giftError(error); }
}
