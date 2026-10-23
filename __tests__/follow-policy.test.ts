import { afterEach, describe, expect, it, vi } from "vitest";
import { deploymentFollowOverrides, requireConfirmedFollow, requireVerifiedEmail, SAFE_FOLLOW_MESSAGES } from "../lib/instagram/follow-policy";

afterEach(() => vi.unstubAllEnvs());

describe("verified email implies a confirmed follow", () => {
  it.each([false, true])("campaign Email requirement cannot bypass follow when env forced=%s", (forced) => {
    vi.stubEnv("REQUIRE_CONFIRMED_FOLLOW", "false");
    vi.stubEnv("REQUIRE_VERIFIED_EMAIL", String(forced));
    expect(requireVerifiedEmail({ requireEmail: !forced })).toBe(true);
    expect(requireConfirmedFollow({ requireFollow: false, requireEmail: !forced })).toBe(true);
  });

  it("does not enable email for existing follow-only campaigns", () => {
    vi.stubEnv("REQUIRE_CONFIRMED_FOLLOW", "true");
    vi.stubEnv("REQUIRE_VERIFIED_EMAIL", "false");
    expect(requireVerifiedEmail({ requireEmail: false })).toBe(false);
    expect(deploymentFollowOverrides()).not.toHaveProperty("requireEmail");
  });

  it("makes deployment overrides describe and enforce both requirements", () => {
    vi.stubEnv("REQUIRE_CONFIRMED_FOLLOW", "false");
    vi.stubEnv("REQUIRE_VERIFIED_EMAIL", "true");
    expect(deploymentFollowOverrides()).toMatchObject({ requireFollow: true, requireEmail: true, followPromptMessage: SAFE_FOLLOW_MESSAGES.emailPrompt, followPromptButtonLabel: "我已完成追蹤" });
    expect(SAFE_FOLLOW_MESSAGES.emailPrompt).toContain("確認 Email");
  });
});
