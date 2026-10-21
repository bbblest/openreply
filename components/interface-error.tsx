"use client";

import type { StaticMessageKey } from "@/lib/i18n";
import { useI18n } from "@/lib/i18n/provider";

/** Keep provider errors available without making users read them in English. */
export default function InterfaceError({ message, fallback, className }: {
  message: string;
  fallback: StaticMessageKey;
  className?: string;
}) {
  const { locale, t } = useI18n();
  const summary = locale === "en" || /[\u3400-\u9fff]/u.test(message)
    ? message
    : t(fallback);
  const showDetails = summary !== message && message !== fallback;

  return (
    <div role="alert" className={className}>
      <p>{summary}</p>
      {showDetails && (
        <details className="mt-1">
          <summary className="cursor-pointer">{t("Technical details")}</summary>
          <p className="mt-1 break-words">{message}</p>
        </details>
      )}
    </div>
  );
}
