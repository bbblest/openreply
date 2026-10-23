"use client";

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";

type GiftPageMode = "claim" | "verify" | "unsubscribe";
type ClaimStage = "email" | "verify" | "ready" | "complete" | "expired";

interface ClaimStatus {
  stage: ClaimStage;
  emailMasked: string | null;
  igStatus: string;
  emailStatus: string;
  verificationStatus: string;
  notice: string | null;
}

const actionClass = "min-h-11 w-full rounded-lg bg-accent px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50";

class GiftRequestError extends Error {}

export function GiftPageFrame({ children }: { children: ReactNode }) {
  return (
    <main lang="zh-Hant" className="min-h-dvh bg-surface px-4 py-10 sm:py-16">
      <div className="mx-auto w-full max-w-md space-y-6">
        <p className="text-sm font-semibold text-muted">徐三代・領取禮物</p>
        <section className="space-y-5 rounded-2xl border border-border bg-background p-5 shadow-sm sm:p-8">
          {children}
        </section>
        <p className="text-center text-xs leading-relaxed text-muted">需要協助時，請回到原本的 Instagram 私訊。</p>
      </div>
    </main>
  );
}

export function GiftPageLoading() {
  return <GiftPageFrame><p role="status" className="text-sm text-muted">正在讀取領取資料…</p></GiftPageFrame>;
}

function requestError(status: number, serverError?: unknown) {
  const retryMessages = [
    "驗證信正在處理，請稍後一分鐘再試。",
    "今天已寄出多次驗證信，請明天再試。",
    "此信箱今天已收到多次驗證信，請明天再試。",
  ];
  if (status === 429 && typeof serverError === "string" && retryMessages.includes(serverError)) return serverError;
  if (status === 429) return "操作太頻繁，請稍後再試。重寄驗證信至少需間隔 60 秒。";
  if (status === 400) return "資料不完整或連結無效，請確認 Email，或回原 Instagram 私訊重新取得連結。";
  if (status === 404 || status === 410) return "這個連結已失效，請回原 Instagram 私訊重新取得連結。";
  return "目前無法完成操作，請稍後再試；若持續失敗，請回原 Instagram 私訊聯絡我們。";
}

function readClaimStatus(value: unknown): ClaimStatus | null {
  if (!value || typeof value !== "object") return null;
  const data = value as Record<string, unknown>;
  if (!["email", "verify", "ready", "complete", "expired"].includes(String(data.stage))) return null;
  return {
    stage: data.stage as ClaimStage,
    emailMasked: typeof data.emailMasked === "string" ? data.emailMasked : null,
    igStatus: typeof data.igStatus === "string" ? data.igStatus : "",
    emailStatus: typeof data.emailStatus === "string" ? data.emailStatus : "",
    verificationStatus: typeof data.verificationStatus === "string" ? data.verificationStatus : "",
    notice: typeof data.notice === "string" && data.notice.trim() ? data.notice : null,
  };
}

function deliveryLabel(status: string, emailChannel: boolean) {
  if (status === "SENT") return emailChannel ? "寄信服務已接受" : "已送出";
  if (status === "FAILED") return "傳送失敗，請回原 Instagram 私訊聯絡我們";
  if (status === "UNCONFIRMED") return "寄送結果待確認";
  if (status === "SENDING") return "傳送中";
  return "等待處理";
}

export function VerificationNotice({ verificationStatus, emailMasked, notice }: Pick<ClaimStatus, "verificationStatus" | "emailMasked" | "notice">) {
  const statusCopy: Record<string, { title: string; message: string }> = {
    SENT: {
      title: "請到信箱確認 Email",
      message: "驗證信已交給寄信服務，請查看收件匣及垃圾郵件匣。收到後，按信中的確認連結，再按頁面上的確認按鈕。",
    },
    SENDING: {
      title: "驗證信寄送中",
      message: "驗證信仍在處理，尚未確認寄出。請稍後更新狀態；處理中可能需要等候兩分鐘才能重寄。",
    },
    FAILED: {
      title: "驗證信寄送失敗",
      message: "這次驗證信寄送失敗。請確認 Email 地址，稍後再重寄。",
    },
    UNCONFIRMED: {
      title: "驗證信寄送結果待確認",
      message: "尚未確認驗證信的寄送結果。請先查看收件匣與垃圾郵件匣，避免重複申請；若未收到，稍後再重寄。",
    },
    PENDING: {
      title: "驗證信等待寄送",
      message: "驗證信尚在等待處理，請稍後更新狀態。",
    },
  };
  const copy = statusCopy[verificationStatus] ?? {
    title: "驗證信狀態待確認",
    message: "目前無法確認驗證信是否已寄出，請稍後更新狀態。",
  };

  return <>
    <h1 className="text-xl font-semibold">{copy.title}</h1>
    <div role="status" className="rounded-lg bg-surface p-3 text-sm leading-relaxed">
      <p>{copy.message}</p>
      {emailMasked && <p className="mt-2 break-all">收信地址：{emailMasked}</p>}
      {notice && <p className="mt-2 font-medium">{notice}</p>}
      <p className="mt-2 text-muted">Email 確認後才會透過 Instagram 私訊與 Email 傳送禮物。</p>
    </div>
  </>;
}

export function GiftDeliveryStatus({ claim }: { claim: ClaimStatus | null }) {
  const notice = claim?.stage === "ready" ? claim.notice : null;
  return <div role="status" className="space-y-3 text-sm leading-relaxed">
    <p>{claim?.stage === "complete"
      ? "禮物已透過 Instagram 私訊送出，Email 已交給寄信服務。"
      : notice ? "禮物尚未完成寄送，請查看下方狀態與提示。"
        : "已安排透過 Instagram 私訊與 Email 傳送禮物，請稍候。"}</p>
    {notice && <p className="rounded-lg border border-warning/30 bg-warning/5 p-3 font-medium">{notice}</p>}
    <p className="text-muted">請回原本的 Instagram 私訊，並查看 Email 收件匣及垃圾郵件匣。</p>
    {claim && <dl className="space-y-2 rounded-lg bg-surface p-3"><div><dt className="font-medium">Instagram 禮物</dt><dd>{deliveryLabel(claim.igStatus, false)}</dd></div><div><dt className="font-medium">Email 禮物</dt><dd>{deliveryLabel(claim.emailStatus, true)}</dd></div></dl>}
  </div>;
}

function GiftFlow({ mode, token }: { mode: GiftPageMode; token: string }) {
  const [claim, setClaim] = useState<ClaimStatus | null>(null);
  const [loading, setLoading] = useState(mode === "claim" && Boolean(token));
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [email, setEmail] = useState("");
  const [marketingConsent, setMarketingConsent] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const nextSendAt = useRef(0);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    // Opening an email link never verifies an address or cancels a subscription.
    if (mode !== "claim" || !token) return;
    const controller = new AbortController();
    fetch(`/api/gifts/claim?${new URLSearchParams({ token })}`, {
      cache: "no-store",
      referrerPolicy: "no-referrer",
      signal: controller.signal,
    })
      .then(async (response) => {
        const payload = await response.json();
        const next = readClaimStatus(payload.data);
        if (!response.ok || !payload.success || !next) throw new GiftRequestError(requestError(response.status, payload.error));
        setClaim(next);
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) setError(cause instanceof GiftRequestError ? cause.message : "讀取失敗，請稍後再試。");
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [mode, token, reload]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = window.setTimeout(() => setCooldown(Math.max(0, Math.ceil((nextSendAt.current - Date.now()) / 1000))), 1000);
    return () => window.clearTimeout(timer);
  }, [cooldown]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !token || (mode === "claim" && cooldown > 0)) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/gifts/${mode}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        referrerPolicy: "no-referrer",
        body: JSON.stringify(mode === "claim" ? { token, email: email.trim(), marketingConsent } : { token }),
      });
      const payload = await response.json();
      if (response.status === 409 && mode === "claim") {
        setLoading(true);
        setReload((value) => value + 1);
        return;
      }
      if (!response.ok || !payload.success) {
        if ((response.status === 429 || response.status === 503) && mode === "claim") {
          nextSendAt.current = Date.now() + 60_000;
          setCooldown(60);
          // A rejected/uncertain SMTP send can still have changed the stored status.
          setReload((value) => value + 1);
        }
        throw new GiftRequestError(requestError(response.status, payload.error));
      }
      if (mode === "claim") {
        setClaim(readClaimStatus(payload.data) ?? {
          stage: "verify",
          emailMasked: typeof payload.data?.emailMasked === "string" ? payload.data.emailMasked : null,
          igStatus: "",
          emailStatus: "",
          verificationStatus: "SENT",
          notice: null,
        });
        nextSendAt.current = Date.now() + 60_000;
        setCooldown(60);
      } else {
        if (mode === "verify") setClaim(readClaimStatus(payload.data));
        setDone(true);
      }
    } catch (cause) {
      // Never render an arbitrary server response that might include private gift content.
      setError(cause instanceof GiftRequestError ? cause.message : "目前無法完成操作，請確認資料後稍後再試。若連結已失效，請回原 Instagram 私訊重新取得連結。");
    } finally {
      setBusy(false);
    }
  }

  if (!token || claim?.stage === "expired") {
    return <GiftPageFrame><h1 className="text-xl font-semibold">領取連結已失效</h1><p className="text-sm leading-relaxed text-muted">請回到原本的 Instagram 私訊，重新取得領取連結後再試。</p></GiftPageFrame>;
  }
  if (loading) return <GiftPageLoading />;

  const deliveryReady = mode === "claim" && (claim?.stage === "ready" || claim?.stage === "complete");
  const confirmed = mode === "verify" && done;
  const unsubscribed = mode === "unsubscribe" && done;

  return (
    <GiftPageFrame>
      {deliveryReady || confirmed ? (
        <>
          <h1 className="text-xl font-semibold">Email 已確認</h1>
          <GiftDeliveryStatus claim={claim} />
          {mode === "claim" && claim?.stage === "ready" && (
            <button type="button" className={actionClass} onClick={() => { setLoading(true); setError(null); setReload((value) => value + 1); }}>更新寄送狀態</button>
          )}
        </>
      ) : unsubscribed ? (
        <>
          <h1 className="text-xl font-semibold">已取消後續通知</h1>
          <p role="status" className="text-sm leading-relaxed text-muted">你已取消徐三代後續內容與活動通知。</p>
        </>
      ) : mode === "claim" && claim ? (
        <>
          {claim.stage === "verify" ? (
            <VerificationNotice verificationStatus={claim.verificationStatus} emailMasked={claim.emailMasked} notice={claim.notice} />
          ) : <><h1 className="text-xl font-semibold">填寫 Email，繼續領取禮物</h1><p className="text-sm leading-relaxed text-muted">我們會先寄一封驗證信。完成 Email 確認後，才會透過 Instagram 私訊與 Email 傳送禮物。</p></>}
          <form method="post" onSubmit={submit} className="space-y-4">
            <div className="space-y-2">
              <label htmlFor="gift-email" className="block text-sm font-medium">{claim.stage === "verify" ? "重寄或更正收信 Email" : "收信 Email（必填）"}</label>
              <input id="gift-email" name="email" type="email" required autoComplete="email" autoCapitalize="none" spellCheck={false} maxLength={254} value={email} onChange={(event) => setEmail(event.target.value)} disabled={busy} placeholder="you@example.com" className="min-h-11 w-full rounded-lg border border-border bg-background px-3 py-3 text-base" />
            </div>
            <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border p-3 text-sm leading-relaxed">
              <input name="marketingConsent" type="checkbox" checked={marketingConsent} onChange={(event) => setMarketingConsent(event.target.checked)} disabled={busy} className="mt-1 h-4 w-4 shrink-0 accent-accent" />
              <span>我願意接收徐三代後續內容與活動通知，可隨時取消<span className="mt-1 block text-xs text-muted">選填；不勾選也可以領取本次禮物。</span></span>
            </label>
            <p className="text-xs leading-relaxed text-muted">Email 用於確認收件地址與寄送本次禮物；後續內容與活動通知另依你的選擇。詳見<a href="/privacy" target="_blank" rel="noreferrer" className="text-accent underline">隱私權說明</a>。</p>
            <button type="submit" disabled={busy || cooldown > 0} className={actionClass}>{busy ? "寄送中…" : cooldown > 0 ? `${cooldown} 秒後可重寄或更正` : claim.stage === "verify" ? "重寄驗證信／更正地址" : "寄送驗證信"}</button>
          </form>
          {claim.stage === "verify" && <button type="button" disabled={busy} onClick={() => { setError(null); setLoading(true); setReload((value) => value + 1); }} className="min-h-11 w-full rounded-lg border border-border px-3 py-2 text-sm">更新驗證信與領取狀態</button>}
        </>
      ) : mode !== "claim" ? (
        <>
          <h1 className="text-xl font-semibold">{mode === "verify" ? "確認 Email，完成領取" : "取消後續內容與活動通知"}</h1>
          <p className="text-sm leading-relaxed text-muted">{mode === "verify" ? "請按下方按鈕確認這是你的 Email。確認後，才會安排 Instagram 私訊與 Email 送禮。" : "按下確認後，將取消徐三代後續內容與活動通知。"}</p>
          <form method="post" onSubmit={submit}>
            <button type="submit" disabled={busy} className={actionClass}>{busy ? "處理中…" : mode === "verify" ? "確認 Email 並領取禮物" : "確認取消通知"}</button>
          </form>
        </>
      ) : null}
      {error && <div role="alert" className="rounded-lg border border-error/20 bg-error/5 p-3 text-sm leading-relaxed text-error">{error}</div>}
      {mode === "claim" && !claim && error && <button type="button" className={actionClass} onClick={() => { setError(null); setLoading(true); setReload((value) => value + 1); }}>重新讀取</button>}
    </GiftPageFrame>
  );
}

export default function GiftClaimForm({ mode = "claim" }: { mode?: GiftPageMode }) {
  const searchParams = useSearchParams();
  const token = searchParams.get("token")?.trim() ?? "";
  return <GiftFlow key={`${mode}:${token}`} mode={mode} token={token} />;
}
