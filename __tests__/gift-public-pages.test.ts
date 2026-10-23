import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const params = vi.hoisted(() => ({ token: "one-use-secret-token" }));
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(params.token ? { token: params.token } : {}),
}));

import GiftClaimForm, { GiftDeliveryStatus, VerificationNotice } from "../components/gift-claim-form";
import { metadata as claimMetadata } from "../app/gift/claim/page";
import { metadata as verifyMetadata } from "../app/gift/verify/page";
import { metadata as unsubscribeMetadata } from "../app/gift/unsubscribe/page";

beforeEach(() => { params.token = "one-use-secret-token"; });

describe("public gift confirmation pages", () => {
  it("shows an explicit POST confirmation before Email verification, without rendering a gift or token", () => {
    const html = renderToStaticMarkup(createElement(GiftClaimForm, { mode: "verify" }));
    expect(html).toContain("確認 Email 並領取禮物");
    expect(html).toContain('method="post"');
    expect(html).toContain('type="submit"');
    expect(html).not.toContain("已安排透過");
    expect(html).not.toContain(params.token);
    expect(html).not.toMatch(/youtube|youtu\.be|href=/i);
  });

  it("asks for an explicit unsubscribe confirmation and does not claim cancellation on open", () => {
    const html = renderToStaticMarkup(createElement(GiftClaimForm, { mode: "unsubscribe" }));
    expect(html).toContain("確認取消通知");
    expect(html).toContain('method="post"');
    expect(html).not.toContain("你已取消");
    expect(html).not.toContain(params.token);
  });

  it.each(["claim", "verify", "unsubscribe"] as const)("rejects a missing token for %s without a submission button", (mode) => {
    params.token = "";
    const html = renderToStaticMarkup(createElement(GiftClaimForm, { mode }));
    expect(html).toContain("領取連結已失效");
    expect(html).not.toContain('type="submit"');
  });

  it.each([claimMetadata, verifyMetadata, unsubscribeMetadata])("keeps token pages out of search indexes and referrer headers", (metadata) => {
    expect(metadata.robots).toEqual({ index: false, follow: false });
    expect(metadata.referrer).toBe("no-referrer");
  });
});

describe("truthful gift delivery notices", () => {
  it.each([
    ["FAILED", "驗證信寄送失敗"],
    ["UNCONFIRMED", "尚未確認驗證信的寄送結果"],
    ["SENDING", "驗證信寄送中"],
    ["PENDING", "驗證信等待寄送"],
    ["", "驗證信狀態待確認"],
  ])("does not describe %s verification mail as sent", (verificationStatus, expected) => {
    const html = renderToStaticMarkup(createElement(VerificationNotice, {
      verificationStatus,
      emailMasked: "a***@example.com",
      notice: null,
    }));
    expect(html).toContain(expected);
    expect(html).toContain("a***@example.com");
    expect(html).not.toContain("驗證信已寄出");
    expect(html).not.toContain("驗證信已交給寄信服務");
    expect(html).not.toContain("請到信箱確認 Email");
    if (verificationStatus === "SENDING") expect(html).toContain("等候兩分鐘才能重寄");
  });

  it("describes SENT as the mail service accepting the verification message", () => {
    const html = renderToStaticMarkup(createElement(VerificationNotice, {
      verificationStatus: "SENT",
      emailMasked: "a***@example.com",
      notice: null,
    }));
    expect(html).toContain("驗證信已交給寄信服務");
    expect(html).toContain("請查看收件匣及垃圾郵件匣");
    expect(html).not.toContain("已送達");
  });

  const readyClaim: NonNullable<ComponentProps<typeof GiftDeliveryStatus>["claim"]> = {
    stage: "ready",
    emailMasked: "a***@example.com",
    verificationStatus: "SENT",
    igStatus: "PENDING",
    emailStatus: "PENDING",
    notice: null,
  };

  it.each([
    "尚未確認到追蹤，未完成的寄送暫停；請追蹤後回 IG 按「確認追蹤」。",
    "IG 發送結果待確認，不會自動重送",
  ])("shows a ready-stage notice rather than only asking the person to wait", (notice) => {
    const html = renderToStaticMarkup(createElement(GiftDeliveryStatus, {
      claim: { ...readyClaim, notice, igStatus: "UNCONFIRMED" },
    }));
    expect(html).toContain(notice);
    expect(html).toContain("禮物尚未完成寄送");
    expect(html).toContain("寄送結果待確認");
    expect(html).not.toContain("已安排透過");
  });

  it("does not repeat an obsolete pause notice once both channels are complete", () => {
    const html = renderToStaticMarkup(createElement(GiftDeliveryStatus, {
      claim: { ...readyClaim, stage: "complete", igStatus: "SENT", emailStatus: "SENT", notice: "之前暫停寄送" },
    }));
    expect(html).not.toContain("之前暫停寄送");
    expect(html).toContain("Email 已交給寄信服務");
  });
});
