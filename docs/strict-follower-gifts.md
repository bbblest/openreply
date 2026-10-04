# Strict follower gifts

This fork checks follower status before gated gift delivery through comments,
keyword DMs, button postbacks (including legacy `reveal:` buttons), read
fallbacks and delayed follow-ups. Only an explicit `true` result releases the
gift. False, unknown, missing fields and lookup errors do not release it.
Button taps request a new check; they do not prove a follow. Pending checks can
retry after 20 and 40 seconds, but retries never turn unknown into permission.

## Require this for every campaign

Set `REQUIRE_CONFIRMED_FOLLOW=true` on **both the web app and worker**. The worker
enforces the rule independently of saved campaign settings. The web app locks
the follow switch on and shows the effective settings when creating, editing,
importing or duplicating campaigns.

In this mode public replies, opening messages, follow prompts, their button
labels and waiting acknowledgements use fixed Traditional Chinese text.
Arbitrary pre-verification text can contain a literal download URL or gift code,
so stripping `{link}` alone would not protect the gift. Put gift content only
in the final DM and its tracked links. Delayed follow-ups are checked again
at sending time.

Without the deployment flag, individual campaigns can still opt out of the
follow gate and use custom prompts. Campaigns with `requireFollow=true` still
withhold final content on unknown status, but their custom public/opening text
is the campaign owner's responsibility.

## Instagram permissions and limits

Meta's User Profile API exposes `is_user_follow_business`. Reading the profile
requires the recipient's consent through supported messaging interactions;
a comment alone may not provide it. If checking stays unavailable, the prompt
asks the person to send a DM and try again. A genuine follower can therefore
be held until Instagram supplies confirmation. See the
[Meta User Profile API](https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/messaging-api/user-profile/#user-consent).

This controls **delivery time**, not future access. Recipients can unfollow
after delivery or forward a received download URL. The `/r/[slug]` redirect is
not a protected download or follower login system.

Before activating a real campaign, connect the intended professional Instagram
account and test non-following, newly-followed and already-following recipients,
as well as an unavailable-status response. Local automated tests do not replace
this account/permission acceptance test.

## Login email

SMTP or Resend sends dashboard login emails. Instagram comments and DMs do not
consume an email quota. An existing paid mailbox with supported SMTP submission
can replace Resend; no new mailbox is required. On Vercel use Node.js SMTP on
465 or 587 (port 25 is blocked), as documented in
[Vercel's SMTP guide](https://vercel.com/kb/guide/serverless-functions-and-smtp).
Store credentials only in local ignored environment files or hosting secrets.
