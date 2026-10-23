import { Suspense } from "react";
import type { Metadata } from "next";
import GiftClaimForm, { GiftPageLoading } from "@/components/gift-claim-form";

export const metadata: Metadata = {
  title: "確認 Email｜徐三代",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default function GiftVerifyPage() {
  return <Suspense fallback={<GiftPageLoading />}><GiftClaimForm mode="verify" /></Suspense>;
}
