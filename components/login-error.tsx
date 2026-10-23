"use client";

import type { StaticMessageKey } from "@/lib/i18n";
import { useI18n } from "@/lib/i18n/provider";

const messages: Record<string, StaticMessageKey> = {
  AccessDenied: "This email address is not allowed to sign in. Contact the administrator.",
  Verification: "This sign-in link is invalid or expired. Please request a new one.",
  EmailSignInError: "Could not send the sign-in email. Please try again later.",
  EmailSignin: "Could not send the sign-in email. Please try again later.",
  Configuration: "The sign-in service is not configured correctly. Contact the administrator.",
};

export default function LoginError({ code }: { code?: string }) {
  const { t } = useI18n();
  if (!code) return null;
  const key = Object.hasOwn(messages, code)
    ? messages[code]
    : "Sign-in failed. Please request a new sign-in link.";
  return (
    <p role="alert" className="mb-5 rounded border border-error/20 bg-error/10 p-3 text-sm text-error">
      {t(key)}
    </p>
  );
}
