import { NextRequest, NextResponse } from "next/server";
import { GiftClaimError } from "./claims";
import { giftBaseUrl } from "./tokens";

export function giftJson(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
}
export function giftError(error: unknown) {
  return error instanceof GiftClaimError
    ? giftJson({ success: false, error: error.message }, error.status)
    : giftJson({ success: false, error: "服務暫時無法處理，請稍後再試。" }, 503);
}
export async function giftRequestBody(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (origin && origin !== giftBaseUrl()) throw new GiftClaimError("請從原領取頁提交。", 403);
  if (Number(request.headers.get("content-length") ?? 0) > 4096) throw new GiftClaimError("資料太長。", 413);
  const body = await request.text();
  if (Buffer.byteLength(body) > 4096) throw new GiftClaimError("資料太長。", 413);
  try { return JSON.parse(body) as unknown; } catch { throw new GiftClaimError("資料格式不正確。"); }
}
