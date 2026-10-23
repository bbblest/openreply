import zhTW from "./zh-TW.json";

export const LOCALE_COOKIE = "openreply-locale";
export type Locale = "en" | "zh-TW";
export const DEFAULT_LOCALE: Locale = "zh-TW";
export type MessageKey = keyof typeof zhTW;

export function isLocale(value: unknown): value is Locale {
  return value === "en" || value === "zh-TW";
}

export function resolveLocale(value: unknown): Locale {
  // This deployment is fixed to Traditional Chinese, including legacy cookies.
  return value === "zh-TW" ? value : DEFAULT_LOCALE;
}

type Placeholders<S extends string> =
  S extends `${string}{${infer Name}}${infer Rest}`
    ? Name | Placeholders<Rest>
    : never;
export type StaticMessageKey = {
  [K in MessageKey]: [Placeholders<K>] extends [never] ? K : never;
}[MessageKey];
type MessageArgs<K extends MessageKey> = [Placeholders<K>] extends [never]
  ? []
  : [values: Record<Placeholders<K>, string | number>];

// English is the source language. Only application-owned copy belongs here;
// campaign messages, account names and API values are never translation keys.
const labels: Record<string, StaticMessageKey> = {
  ALL: "All",
  SENT: "Sent",
  FAILED: "Failed",
  PENDING: "Pending",
  SKIPPED_RATE_LIMIT: "Rate limited",
  SKIPPED_PLAN_LIMIT: "Plan limit",
  SKIPPED_DEDUP: "Dedup",
  OWNER: "Owner",
  ADMIN: "Admin",
  MEMBER: "Member",
  all: "All",
  active: "Active",
  paused: "Paused",
  waiting: "Waiting",
  delayed: "Delayed",
  failed: "Failed",
  Mon: "Mon",
  Tue: "Tue",
  Wed: "Wed",
  Thu: "Thu",
  Fri: "Fri",
  Sat: "Sat",
  Sun: "Sun",
  "DTC Product Link Drop": "DTC Product Link Drop",
  "Real Estate Lead Form": "Real Estate Lead Form",
  "Fitness Plan Download": "Fitness Plan Download",
  "Course Webinar Invite": "Course Webinar Invite",
  "Beauty Service Price List": "Beauty Service Price List",
  "Restaurant Menu And Reservation": "Restaurant Menu And Reservation",
  "Event RSVP Campaign": "Event RSVP Campaign",
  "Creator Media Kit Reply": "Creator Media Kit Reply",
};

export function createI18n(locale: Locale) {
  function t<K extends MessageKey>(key: K, ...args: MessageArgs<K>): string {
    const message = locale === "zh-TW" ? zhTW[key] : key;
    const values = args[0] as Record<string, string | number> | undefined;
    return message.replace(/\{(\w+)\}/g, (placeholder, name: string) =>
      values?.[name] === undefined ? placeholder : String(values[name]),
    );
  }

  return {
    locale,
    t,
    label: (value: string) =>
      Object.hasOwn(labels, value) ? t(labels[value]) : value,
  };
}

export type I18n = ReturnType<typeof createI18n>;
