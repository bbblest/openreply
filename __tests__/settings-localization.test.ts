import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const navigation = vi.hoisted(() => ({ pathname: "/contacts", search: "" }));
vi.mock("next/navigation", () => ({
  usePathname: () => navigation.pathname,
  useSearchParams: () => new URLSearchParams(navigation.search),
}));

import { I18nProvider } from "../lib/i18n/provider";
import { createI18n } from "../lib/i18n";
import TopBar from "../components/top-bar";
import LanguageSwitcher from "../components/language-switcher";
import LoginError from "../components/login-error";
import InterfaceError from "../components/interface-error";
import { InstagramConnectNotice } from "../components/instagram-connect-notice";
import { CAMPAIGN_TEMPLATES } from "../lib/templates/campaign-templates";

describe("Traditional Chinese settings interface", () => {
  it("normalizes an English provider locale and shows the contacts page title", () => {
    const providerProps = {
      locale: "en" as const,
      children: createElement(TopBar, {
        onMenuClick: () => {}, instagramUsername: "good01.tw", instagramAccountCount: 1,
      }),
    };
    const html = renderToStaticMarkup(createElement(I18nProvider, providerProps));
    expect(html).toContain('lang="zh-TW"');
    expect(html).toContain(">聯絡人</h1>");
    expect(html).toContain("@good01.tw");
    expect(html).not.toContain("Dashboard");
    expect(html).not.toContain("儀表板");
  });

  it("shows a fixed language without an English selection", () => {
    const html = renderToStaticMarkup(createElement(LanguageSwitcher));
    expect(html).toContain("繁體中文（固定）");
    expect(html).not.toContain("<select");
    expect(html).not.toContain("English");
  });

  it.each([
    ["AccessDenied", "沒有登入權限"],
    ["Verification", "無效或已過期"],
    ["EmailSignInError", "無法寄送登入郵件"],
    ["Configuration", "登入服務設定尚未完成"],
    ["untrusted English error", "無法登入"],
  ])("explains login error %s in Chinese without echoing the code", (code, expected) => {
    const html = renderToStaticMarkup(createElement(LoginError, { code }));
    expect(html).toContain('role="alert"');
    expect(html).toContain(expected);
    expect(html).not.toContain(code);
  });

  it("keeps original English provider evidence inside collapsed details", () => {
    const html = renderToStaticMarkup(createElement(InterfaceError, {
      message: "Provider request timed out", fallback: "Could not update connection.",
    }));
    expect(html).toContain("<p>無法更新連線。</p>");
    expect(html).toMatch(/<details[^>]*>.*技術詳情.*Provider request timed out<\/p><\/details>/);
    expect(html).not.toContain("<details open");
  });

  it("gives Chinese names for missing connection settings with raw names in details", () => {
    navigation.search = "instagram=misconfigured&missing=INSTAGRAM_APP_ID,ENCRYPTION_KEY";
    const html = renderToStaticMarkup(createElement(InstagramConnectNotice));
    const main = html.split("<details")[0];
    expect(main).toContain("Instagram 應用程式編號");
    expect(main).toContain("資料加密金鑰");
    expect(main).not.toContain("INSTAGRAM_APP_ID");
    expect(main).not.toContain("ENCRYPTION_KEY");
    expect(html).toContain("INSTAGRAM_APP_ID");
  });

  it("localizes all built-in template names shown during login", () => {
    for (const template of CAMPAIGN_TEMPLATES) {
      expect(createI18n("zh-TW").label(template.title)).toMatch(/[\u3400-\u9fff]/u);
    }
  });
});
