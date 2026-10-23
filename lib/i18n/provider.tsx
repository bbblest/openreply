"use client";

import { createContext, useContext, useEffect, useMemo } from "react";
import { createI18n, DEFAULT_LOCALE, resolveLocale, type Locale } from "./index";

// Shared controls use the same default even outside a localized layout.
const I18nContext = createContext(createI18n(DEFAULT_LOCALE));

export function I18nProvider({
  locale,
  children,
}: {
  locale: Locale;
  children: React.ReactNode;
}) {
  const interfaceLocale = resolveLocale(locale);
  const value = useMemo(() => createI18n(interfaceLocale), [interfaceLocale]);

  useEffect(() => {
    const previous = document.documentElement.lang;
    document.documentElement.lang = interfaceLocale;
    return () => {
      document.documentElement.lang = previous;
    };
  }, [interfaceLocale]);

  return (
    <I18nContext.Provider value={value}>
      <div lang={interfaceLocale} className="contents">
        {children}
      </div>
    </I18nContext.Provider>
  );
}

export function useI18n() {
  return useContext(I18nContext);
}
