import { Suspense } from "react";
import type { Metadata } from "next";
import GiftClaimForm, { GiftPageLoading } from "@/components/gift-claim-form";

export const metadata: Metadata = {
  title: "取消後續通知｜徐三代",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default function GiftUnsubscribePage() {
  return <Suspense fallback={<GiftPageLoading />}><GiftClaimForm mode="unsubscribe" /></Suspense>;
}
