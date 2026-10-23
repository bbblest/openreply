import { NextRequest } from "next/server";
import { z } from "zod";
import { GiftClaimError, unsubscribeGiftContact } from "@/lib/gifts/claims";
import { giftError, giftJson, giftRequestBody } from "@/lib/gifts/http";

export async function POST(request: NextRequest) {
  try {
    const parsed = z.object({ token: z.string().max(1024) }).safeParse(await giftRequestBody(request));
    if (!parsed.success) throw new GiftClaimError("取消訂閱連結不正確。");
    return giftJson({ success: true, data: await unsubscribeGiftContact(parsed.data.token) });
  } catch (error) { return giftError(error); }
}
