import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const store = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: async () => store }));

import { setLocale } from "../lib/i18n/actions";
import { getI18n } from "../lib/i18n/server";
import { LOCALE_COOKIE } from "../lib/i18n";

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.unstubAllEnvs());

describe("language preference", () => {
  it("renders a saved language on the server before hydration", async () => {
    store.get.mockReturnValue({ value: "zh-TW" });
    const { locale, t } = await getI18n();
    expect(store.get).toHaveBeenCalledWith(LOCALE_COOKIE);
    expect(locale).toBe("zh-TW");
    expect(t("Settings")).toBe("設定");
  });

  it("uses Traditional Chinese when the saved preference is missing or invalid", async () => {
    store.get.mockReturnValue({ value: "unsupported" });
    expect((await getI18n()).locale).toBe("zh-TW");
    store.get.mockReturnValue({ value: "en" });
    expect((await getI18n()).t("Settings")).toBe("設定");
    store.get.mockReturnValue(undefined);
    expect((await getI18n()).locale).toBe("zh-TW");
  });

  it("persists only the language cookie, across routes and browser restarts", async () => {
    vi.stubEnv("NODE_ENV", "production");
    await setLocale("zh-TW");
    expect(store.set).toHaveBeenCalledExactlyOnceWith(LOCALE_COOKIE, "zh-TW", {
      path: "/",
      maxAge: 31_536_000,
      sameSite: "lax",
      httpOnly: true,
      secure: true,
    });
  });

  it("keeps Traditional Chinese fixed even during local development", async () => {
    vi.stubEnv("NODE_ENV", "development");
    await expect(setLocale("en")).rejects.toThrow("本系統介面固定使用繁體中文。");
    expect(store.set).not.toHaveBeenCalled();
  });

  it("rejects an unsupported locale without writing cookies", async () => {
    await expect(setLocale("en; path=/")).rejects.toThrow("本系統介面固定使用繁體中文。");
    expect(store.set).not.toHaveBeenCalled();
  });
});
