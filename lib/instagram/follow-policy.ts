/** Server-side policy for deployments that only deliver gifts to followers. */
export function isFollowRequiredByDeployment(): boolean {
  return process.env.REQUIRE_CONFIRMED_FOLLOW === "true";
}

export function requireConfirmedFollow(automation: { requireFollow?: boolean }): boolean {
  return isFollowRequiredByDeployment() || automation.requireFollow === true;
}

// Unverified recipients and public comments must never receive configurable
// gift content in the forced mode, even when it is a literal URL or gift code.
export const SAFE_FOLLOW_MESSAGES = {
  publicReply: "領取方式會透過私訊提供，請先追蹤本帳號並查看訊息邀請。",
  opening: "領取禮物前，請先追蹤本帳號，再按下方按鈕確認。",
  prompt: "請先追蹤本帳號，再按下方按鈕。系統確認追蹤成功後才會傳送禮物。",
  unknown: "目前還無法確認追蹤狀態，禮物尚未發送。若已追蹤，請先回覆任意文字，稍等後再按下方按鈕確認。",
  button: "確認追蹤",
  acknowledgement: "正在確認追蹤狀態，請稍候；確認成功後才會傳送禮物。",
} as const;

/** Apply last when reading or saving campaigns so stored settings match delivery. */
export function deploymentFollowOverrides() {
  if (!isFollowRequiredByDeployment()) return {};

  return {
    requireFollow: true,
    publicReplyMessage: SAFE_FOLLOW_MESSAGES.publicReply,
    publicReplyMessages: [SAFE_FOLLOW_MESSAGES.publicReply],
    openingDmMessage: SAFE_FOLLOW_MESSAGES.opening,
    openingDmButtonLabel: SAFE_FOLLOW_MESSAGES.button,
    followPromptMessage: SAFE_FOLLOW_MESSAGES.prompt,
    followPromptButtonLabel: SAFE_FOLLOW_MESSAGES.button,
  };
}
