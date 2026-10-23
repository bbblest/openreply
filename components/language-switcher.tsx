"use client";

import { useI18n } from "@/lib/i18n/provider";

export default function LanguageSwitcher() {
  const { t } = useI18n();

  return (
    <p className="inline-flex flex-wrap items-center gap-2 text-sm text-muted">
      <span>{t("Language")}</span>
      <span className="rounded border border-border bg-surface px-2 py-1.5 text-foreground">
        {t("Traditional Chinese (fixed)")}
      </span>
    </p>
  );
}
