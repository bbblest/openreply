import { isValidElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ signIn: vi.fn(), redirect: vi.fn() }));
vi.mock("@/lib/auth", () => ({ EMAIL_PROVIDER_ID: "nodemailer", signIn: mocks.signIn }));
vi.mock("@/lib/env", () => ({ isPublicDemoHost: async () => false, DEMO_HOST: "demo.example.test" }));
vi.mock("@/lib/i18n/server", async () => {
  const { createI18n } = await import("../lib/i18n");
  return { getI18n: async () => createI18n("zh-TW") };
});
vi.mock("next-auth", () => ({ AuthError: class AuthError extends Error { type = "AccessDenied"; } }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));

import { AuthError } from "next-auth";
import LoginPage from "../app/login/page";

type FormAction = (data: FormData) => Promise<void>;
function formAction(node: ReactNode): FormAction | undefined {
  if (Array.isArray(node)) {
    for (const child of node) {
      const result = formAction(child);
      if (result) return result;
    }
    return undefined;
  }
  if (!isValidElement<{ children?: ReactNode; action?: unknown }>(node)) return undefined;
  if (node.type === "form" && typeof node.props.action === "function") return node.props.action as FormAction;
  return formAction(node.props.children);
}

beforeEach(() => vi.clearAllMocks());

describe("localized sign-in failures", () => {
  it("routes thrown Auth.js errors to the Chinese login page without sending test email", async () => {
    mocks.signIn.mockRejectedValueOnce(new AuthError("English provider evidence"));
    const page = await LoginPage({ searchParams: Promise.resolve({ callbackUrl: "/settings" }) });
    const action = formAction(page);
    expect(action).toBeDefined();
    const form = new FormData();
    form.set("email", "test@example.test");
    await action!(form);
    expect(mocks.signIn).toHaveBeenCalledWith("nodemailer", { email: "test@example.test", redirectTo: "/settings" });
    expect(mocks.redirect).toHaveBeenCalledExactlyOnceWith("/login?error=AccessDenied&callbackUrl=%2Fsettings");
  });

  it("preserves Next.js redirects instead of reporting a successful login as an error", async () => {
    const redirect = new Error("NEXT_REDIRECT");
    mocks.signIn.mockRejectedValueOnce(redirect);
    const page = await LoginPage({ searchParams: Promise.resolve({}) });
    await expect(formAction(page)!(new FormData())).rejects.toBe(redirect);
    expect(mocks.redirect).not.toHaveBeenCalled();
  });
});
