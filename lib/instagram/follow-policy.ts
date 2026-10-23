/** Server-side policy for deployments that only deliver gifts to followers. */
export function isFollowRequiredByDeployment(): boolean {
  return process.env.REQUIRE_CONFIRMED_FOLLOW === "true" || isEmailRequiredByDeployment();
}

export function isEmailRequiredByDeployment(): boolean {
  return process.env.REQUIRE_VERIFIED_EMAIL === "true";
}

export function requireVerifiedEmail(automation: { requireEmail?: boolean }): boolean {
  return isEmailRequiredByDeployment() || automation.requireEmail === true;
}

export function requireConfirmedFollow(automation: { requireFollow?: boolean; requireEmail?: boolean }): boolean {
  return isFollowRequiredByDeployment() || automation.requireFollow === true || requireVerifiedEmail(automation);
}

// Unverified recipients and public comments must never receive configurable
// gift content in the forced mode, even when it is a literal URL or gift code.
export const SAFE_FOLLOW_MESSAGES = {
  publicReply: "領取方式會透過私訊提供，請先追蹤本帳號並查看訊息邀請。",
  opening: "領取禮物前，請先追蹤本帳號，再按下方按鈕確認。",
  prompt: "謝謝妳的留言，這份IG禮物是送給，追蹤的朋友，\n追蹤完成點擊下方連結立即領取",
  emailPrompt: "謝謝妳的留言，這份IG禮物是送給，追蹤的朋友，\n追蹤完成點擊下方按鈕，再填寫並確認 Email，即可領取禮物。",
  retryPrompt: "還沒確認到你的追蹤喔，追蹤後再按一次『我已完成追蹤』。",
  unknown: "目前還無法確認追蹤狀態，禮物尚未發送。若已追蹤，請先回覆任意文字，稍等後再按下方按鈕確認。",
  button: "我已完成追蹤",
  retryButton: "我已完成追蹤",
  acknowledgement: "正在確認，請稍候一下喔！",
  cooldown: "按太多次囉，系統先休息一下。請先完成追蹤，30 分鐘後再按一次。",
  emailRequest: "已確認追蹤！請填寫 Email，並到信箱按「確認領取」。完成後，禮物會透過 IG 私訊和 Email 送給你。",
  emailButton: "填寫 Email",
  claimComplete: "禮物先前已送到這個 IG 聊天室，Email 也已交給寄信服務，寄往當時驗證的信箱。本次不會重複寄送。",
  claimHistoryButton: "查看領取紀錄",
  claimPending: "你的 Email 已驗證，這個活動的寄送尚未全部完成。請查看目前狀態；已成功的部分不會重複寄送。",
  claimStatusButton: "查看寄送狀態",
} as const;

/** Apply last when reading or saving campaigns so stored settings match delivery. */
export function deploymentFollowOverrides() {
  if (!isFollowRequiredByDeployment()) return {};

  return {
    requireFollow: true,
    ...(isEmailRequiredByDeployment() ? { requireEmail: true } : {}),
    publicReplyMessage: SAFE_FOLLOW_MESSAGES.publicReply,
    publicReplyMessages: [SAFE_FOLLOW_MESSAGES.publicReply],
    openingDmMessage: SAFE_FOLLOW_MESSAGES.opening,
    openingDmButtonLabel: SAFE_FOLLOW_MESSAGES.button,
    followPromptMessage: isEmailRequiredByDeployment() ? SAFE_FOLLOW_MESSAGES.emailPrompt : SAFE_FOLLOW_MESSAGES.prompt,
    followPromptButtonLabel: SAFE_FOLLOW_MESSAGES.button,
  };
}
