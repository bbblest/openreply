"use client";

import type { StaticMessageKey } from "@/lib/i18n";
import { useI18n } from "@/lib/i18n/provider";
import { useSearchParams } from "next/navigation";

type Tone = "error" | "warning" | "success";

const TONE_CLASSES: Record<Tone, string> = {
  error: "border-error/20 bg-error/10 text-error",
  warning: "border-warning/20 bg-warning/10 text-warning",
  success: "border-success/20 bg-success/10 text-success",
};

const MESSAGES: Record<string, { tone: Tone; title: StaticMessageKey; detail: StaticMessageKey }> = {
  denied: {
    tone: "warning",
    title: "Instagram connection cancelled",
    detail:
      "You declined the permission prompt on Instagram. Start again and accept all requested permissions.",
  },
  invalid: {
    tone: "error",
    title: "Instagram connection expired",
    detail:
      "The login link was missing or older than 10 minutes. Click Connect Instagram to start a fresh attempt.",
  },
  forbidden: {
    tone: "error",
    title: "Not permitted",
    detail:
      "Only workspace owners and admins can connect an Instagram account.",
  },
  already_connected: {
    tone: "warning",
    title: "Account already connected",
    detail:
      "That Instagram account is connected to another workspace. Disconnect it there first, or connect a different account.",
  },
};

const settingLabels: Record<string, StaticMessageKey> = {
  INSTAGRAM_APP_ID: "Instagram application ID",
  INSTAGRAM_APP_SECRET: "Instagram application secret",
  ENCRYPTION_KEY: "Data encryption key",
  NEXTAUTH_SECRET: "Sign-in security key",
  NEXTAUTH_URL: "Application base URL",
};

export function InstagramConnectNotice() {
  const { t } = useI18n();
  const searchParams = useSearchParams();
  const status = searchParams.get("instagram");

  if (!status) return null;

  if (status === "misconfigured") {
    const missing = (searchParams.get("missing") ?? "")
      .split(",")
      .filter(Boolean);

    return (
      <Notice tone="error" title={t("Instagram app not configured")}>
        <p>
          {t("Contact the administrator to complete the missing connection settings.")}
        </p>
        {missing.length > 0 && (
          <ul className="mt-2 space-y-1">
            {missing.map((name) => (
              <li key={name} className="text-xs">
                {t(Object.hasOwn(settingLabels, name) ? settingLabels[name] : "Other server setting")}
              </li>
            ))}
          </ul>
        )}
        <details className="mt-2 text-xs">
          <summary className="cursor-pointer">{t("Technical details")}</summary>
          <p className="mt-1 break-words font-mono">{missing.join(", ")}</p>
          <p className="mt-2">
            {t("See")} <span className="font-mono">docs/setup.md</span> {t("for how to obtain each value. Note that")}{" "}
            <span className="font-mono">ENCRYPTION_KEY</span> {t("must be a 64-character hex string.")}
          </p>
        </details>
      </Notice>
    );
  }

  if (status === "failed") {
    const reason = searchParams.get("reason");

    return (
      <Notice tone="error" title={t("Instagram connection failed")}>
        <p>
          {t("Instagram accepted the login but the connection could not be completed. This is usually a mismatched redirect URI or an app that is missing the required permissions.")}
        </p>
        {reason && (
          <details className="mt-2 text-xs opacity-80">
            <summary className="cursor-pointer">{t("Technical details")}</summary>
            <p className="mt-1 font-mono break-words">{reason}</p>
          </details>
        )}
      </Notice>
    );
  }

  const known = MESSAGES[status];
  if (!known) return null;

  return (
    <Notice tone={known.tone} title={t(known.title)}>
      <p>{t(known.detail)}</p>
    </Notice>
  );
}

function Notice({
  tone,
  title,
  children,
}: {
  tone: Tone;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className={`rounded border p-4 text-sm ${TONE_CLASSES[tone]}`}>
      <p className="font-semibold">{title}</p>
      <div className="mt-1 opacity-90">{children}</div>
    </div>
  );
}
