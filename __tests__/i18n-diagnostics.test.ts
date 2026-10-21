import { describe, expect, it } from "vitest";
import { diagnosticLevel, diagnosticMessage, diagnosticSource } from "../lib/i18n/diagnostics";

describe("diagnostic summaries", () => {
  it("explains a rejected gift without claiming the recipient is not following", () => {
    const original = "Follow gate rejected a button tap";
    const result = diagnosticMessage(original, "zh-TW");
    expect(result.summary).toBe("尚未確認已追蹤，本次未發送禮物。");
    expect(result.details).toBe(original);
    expect(result.summary).not.toContain("尚未追蹤");
  });

  it.each([
    ["Webhook signature verification failed", "通知來源驗證失敗"],
    ["Token refresh failed for @example: expired", "Instagram 授權更新失敗"],
    ["DM worker job 123 failed: timeout", "背景執行程式發生錯誤"],
    ["Follower snapshot failed", "無法更新追蹤人數紀錄"],
  ])("summarizes known events and retains the complete evidence: %s", (message, summary) => {
    expect(diagnosticMessage(message, "zh-TW")).toEqual({ summary: expect.stringContaining(summary), details: message });
  });

  it("keeps unknown, multiline and HTML-looking errors verbatim in technical details", () => {
    const message = "Unexpected provider error #999\n<script>alert('x')</script>";
    const result = diagnosticMessage(message, "zh-TW");
    expect(result.summary).toContain("技術詳情");
    expect(result.details).toBe(message);
    expect(diagnosticMessage(message, "en")).toEqual({ summary: message, details: message });
  });

  it("translates known codes without treating object properties as labels", () => {
    expect(diagnosticLevel("warning", "zh-TW")).toBe("警告");
    expect(diagnosticLevel("ERROR", "zh-TW")).toBe("錯誤");
    expect(diagnosticSource("WORKER", "zh-TW")).toBe("背景執行程式");
    expect(diagnosticSource("TOKEN_REFRESH", "zh-TW")).toBe("Instagram 授權更新");
    expect(diagnosticSource("__proto__", "zh-TW")).toBe("其他來源");
    expect(diagnosticLevel("toString", "zh-TW")).toBe("其他等級");
    expect(diagnosticSource("FUTURE", "en")).toBe("FUTURE");
  });
});
