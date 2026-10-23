"use client";
import { usePathname } from "next/navigation";
import { Analytics } from "@vercel/analytics/next";

export default function SiteAnalytics() {
  const path = usePathname();
  // Claim and verification URLs contain bearer tokens, never send to analytics.
  if (path === "/gift" || path.startsWith("/gift/")) return null;
  return <Analytics beforeSend={(event) => new URL(event.url).pathname.startsWith("/gift/") ? null : event} />;
}
