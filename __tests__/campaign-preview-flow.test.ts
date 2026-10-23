import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/i18n/provider", async () => {
  const { createI18n } = await import("../lib/i18n");
  const i18n = createI18n("zh-TW");
  return { useI18n: () => i18n };
});
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import CampaignPreview from "../components/campaign-preview";
import CampaignBuilder from "../components/campaign-builder";

const props: ComponentProps<typeof CampaignPreview> = {
  tab: "dm",
  onTabChange: () => {},
  username: "test_business",
  avatarUrl: null,
  postThumb: null,
  caption: "測試貼文",
  sampleComment: "禮物",
  dmTriggerEnabled: true,
  publicReplyEnabled: true,
  publicReplyMessage: "請查看私訊",
  // An old saved campaign can still have both options set. The preview must
  // show the effective one-step gate, not two separate confirmation buttons.
  openingDmEnabled: true,
  openingDmMessage: "舊版多餘開場",
  openingDmButtonLabel: "舊版開場按鈕",
  revealMessage: "確認後的禮物內容 {link}",
  hasLink: true,
  linkButtonLabel: "領取禮物",
  linkUrl: "https://example.test/gift",
  hasSecondLink: false,
  secondLinkButtonLabel: "",
  requireFollow: true,
  followPromptMessage: "請先追蹤測試帳號，再按按鈕",
  followPromptButtonLabel: "確認追蹤",
  followUpEnabled: false,
  followUpMessage: "",
};

describe("campaign follow-first preview", () => {
  it.each(["dm", "dmTrigger"] as const)(
    "%s shows one confirmation before the successful gift, including legacy opening settings",
    (tab) => {
      const html = renderToStaticMarkup(createElement(CampaignPreview, { ...props, tab }));
      expect(html).not.toContain("舊版多餘開場");
      expect(html).not.toContain("舊版開場按鈕");
      expect(html.match(/>確認追蹤</g)).toHaveLength(1);
      const prompt = html.indexOf(props.followPromptMessage);
      const check = html.indexOf("Instagram 確認已追蹤後");
      const gift = html.indexOf("確認後的禮物內容");
      expect(prompt).toBeGreaterThan(-1);
      expect(check).toBeGreaterThan(prompt);
      expect(gift).toBeGreaterThan(check);
      expect(html).toContain("尚未追蹤或無法確認時，只會收到提示，不會收到禮物");
      expect(html).toContain("留言觸發私訊");
      expect(html).toContain("私訊觸發");
    },
  );

  it("keeps an optional opening for campaigns without a follow requirement", () => {
    const html = renderToStaticMarkup(
      createElement(CampaignPreview, { ...props, requireFollow: false }),
    );
    expect(html).toContain("舊版多餘開場");
    expect(html).toContain("舊版開場按鈕");
    expect(html).not.toContain(props.followPromptMessage);
    expect(html).not.toContain("Instagram 確認已追蹤後");
  });

  it("renders the strict editor as two clear steps without an extra opening option", () => {
    const html = renderToStaticMarkup(
      createElement(CampaignBuilder, {
        mode: "new",
        followPolicy: {
          required: true,
          messages: {
            publicReply: "請查看私訊",
            opening: "舊版多餘開場",
            prompt: props.followPromptMessage,
            button: props.followPromptButtonLabel,
          },
        },
      }),
    );
    expect(html).toContain("第一步：提示追蹤並按鈕確認");
    expect(html).toContain("第二步：確認已追蹤後傳送禮物");
    expect(html).not.toContain("開場私訊");
    expect(html).not.toContain("舊版多餘開場");
    expect(html).toContain("所有活動皆須確認追蹤");
    expect(html).toContain("留言與關鍵字私訊都會先收到這則提示");
  });

  it.each(["dm", "dmTrigger"] as const)(
    "%s places Email collection and confirmation before any gift content",
    (tab) => {
      const html = renderToStaticMarkup(createElement(CampaignPreview, { ...props, tab, requireEmail: true }));
      const followCheck = html.indexOf("Instagram 確認已追蹤後");
      const collectEmail = html.indexOf("填寫 Email");
      const emailCheck = html.indexOf("電子信箱確認完成後");
      const gift = html.indexOf("確認後的禮物內容");
      expect(followCheck).toBeGreaterThan(-1);
      expect(collectEmail).toBeGreaterThan(followCheck);
      expect(emailCheck).toBeGreaterThan(collectEmail);
      expect(gift).toBeGreaterThan(emailCheck);
      expect(html.slice(0, emailCheck)).not.toContain("https://example.test/gift");
      expect(html).toContain("並寄送一份至電子信箱");
      expect(html).not.toContain("舊版多餘開場");
    },
  );

  it("enforces the Email flow in a new editor even when the ordinary follow option is off", () => {
    const html = renderToStaticMarkup(createElement(CampaignBuilder, {
      mode: "new",
      emailPolicy: { required: true },
      followPolicy: {
        required: false,
        messages: {
          publicReply: "請查看私訊",
          opening: "開場提示",
          prompt: "追蹤提示",
          button: "確認追蹤",
        },
      },
    }));
    expect(html).toContain("所有活動皆須確認電子信箱，此要求已固定啟用");
    expect(html).toContain("確認追蹤與電子信箱後，才傳送禮物");
    expect(html).toContain("不預先勾選；未同意也能領取本次禮物");
    expect(html).toContain("先收到追蹤提示");
    expect(html).not.toContain("開場私訊");
    expect(html.match(/role="switch" aria-checked="true" disabled=""/g)).toHaveLength(2);
  });
});
