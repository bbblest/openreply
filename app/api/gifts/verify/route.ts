import { NextRequest } from "next/server";
import { z } from "zod";
import { GiftClaimError, confirmGiftEmail } from "@/lib/gifts/claims";
import { giftError, giftJson, giftRequestBody } from "@/lib/gifts/http";

// GET is intentionally unsupported: mail security scanners never consume a token.
export async function POST(request: NextRequest) {
  try {
    const parsed = z.object({ token: z.string().max(1024) }).safeParse(await giftRequestBody(request));
    if (!parsed.success) throw new GiftClaimError("驗證連結不正確。");
    return giftJson({ success: true, data: await confirmGiftEmail(parsed.data.token) });
  } catch (error) { return giftError(error); }
}
