import { Suspense } from "react";
import type { Metadata } from "next";
import GiftClaimForm, { GiftPageLoading } from "@/components/gift-claim-form";

export const metadata: Metadata = {
  title: "填寫 Email 領取禮物｜徐三代",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default function GiftClaimPage() {
  return <Suspense fallback={<GiftPageLoading />}><GiftClaimForm /></Suspense>;
}
