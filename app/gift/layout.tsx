import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "領取專屬禮物｜徐三代",
  description: "確認追蹤並驗證 Email，領取你的專屬禮物。",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};
export default function GiftLayout({ children }: { children: React.ReactNode }) {
  return children;
}
