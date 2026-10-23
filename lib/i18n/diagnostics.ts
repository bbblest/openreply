import { createI18n, type Locale, type StaticMessageKey } from "./index";

const levelLabels: Record<string, StaticMessageKey> = {
  INFO: "Information",
  WARNING: "Warning",
  ERROR: "Error",
};

const sourceLabels: Record<string, StaticMessageKey> = {
  WORKER: "Background worker",
  TOKEN_REFRESH: "Instagram token refresh",
  HEALTH: "Health check",
  SYSTEM: "System",
};

export function diagnosticLevel(value: string, locale: Locale): string {
  const key = value.toUpperCase();
  return Object.hasOwn(levelLabels, key)
    ? createI18n(locale).t(levelLabels[key])
    : locale === "en" ? value : createI18n(locale).t("Other level");
}

export function diagnosticSource(value: string, locale: Locale): string {
  return Object.hasOwn(sourceLabels, value)
    ? createI18n(locale).t(sourceLabels[value])
    : locale === "en" ? value : createI18n(locale).t("Other source");
}

const summaries: Record<string, StaticMessageKey> = {
  "Follow gate rejected a button tap": "Follow not confirmed; the gift was withheld.",
  "Webhook signature verification failed": "Webhook verification failed; the notification was rejected.",
  "Follower snapshot failed": "Could not update follower history.",
};

// Keep the original available for diagnosis. Do not guess whether an unknown
// follow status means the recipient has not followed the account.
export function diagnosticMessage(message: string, locale: Locale) {
  if (locale === "en" || /[\u3400-\u9fff]/u.test(message)) return { summary: message, details: message };
  let key: StaticMessageKey = "System event recorded. Open technical details for the original message.";
  if (Object.hasOwn(summaries, message)) key = summaries[message];
  else if (message.startsWith("Token refresh failed for @")) key = "Instagram token refresh failed.";
  else if (/^DM worker (?:job .+ failed:|process error:)/.test(message)) key = "The background worker encountered an error.";
  return { summary: createI18n(locale).t(key), details: message };
}
