"use client";

import { useEffect, useState } from "react";

interface Contact {
  id: string;
  email: string;
  instagramUsername: string | null;
  automationName: string;
  emailVerifiedAt: string | null;
  marketingConsent: boolean;
  unsubscribedAt: string | null;
  igStatus: string;
  emailStatus: string;
  createdAt: string;
}

function dateLabel(value: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString("zh-TW", { timeZone: "Asia/Taipei", hour12: false });
}

function giftDeliveryLabel(status: string, channel: "instagram" | "email") {
  if (status === "SENT") return channel === "email" ? "寄信服務已接受" : "已送出";
  return ({ PENDING: "等待處理", SENDING: "傳送中", FAILED: "傳送失敗", UNCONFIRMED: "結果待確認" } as Record<string, string>)[status] ?? "尚無寄送狀態";
}

function consentLabel(contact: Contact) {
  return contact.unsubscribedAt ? "已取消通知" : contact.marketingConsent ? "已同意後續通知" : "未同意後續通知";
}

export default function ContactsPage() {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/contacts", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok || !payload.success || !Array.isArray(payload.data)) throw new Error("load");
        setContacts(payload.data);
      })
      .catch(() => { if (!controller.signal.aborted) setError("無法讀取聯絡人，請稍後再試。"); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [revision]);

  return (
    <div lang="zh-Hant" className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold">聯絡人</h1>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted">查看領禮電子郵件、驗證與雙邊寄送狀態。領取禮物不等於同意行銷；後續通知僅限已同意且未取消的聯絡人。</p>
        </div>
        <div className="flex shrink-0 gap-2">
          <button type="button" disabled={loading} onClick={() => { setLoading(true); setError(null); setRevision((value) => value + 1); }} className="min-h-11 rounded-lg border border-border px-4 py-2 text-sm disabled:opacity-50">{loading ? "讀取中…" : "重新整理"}</button>
          <a href="/api/contacts?format=csv" className="inline-flex min-h-11 items-center rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover">匯出最新試算表</a>
        </div>
      </div>

      <p className="text-xs leading-relaxed text-muted">目前最多顯示最新 1,000 筆，試算表匯出也有筆數上限。「寄信服務已接受」表示郵件已交給寄信服務，不代表對方已收到或閱讀。日期時間為台北時間。</p>
      {error && <p role="alert" className="rounded-lg border border-error/20 bg-error/5 p-4 text-sm text-error">{error}</p>}
      {loading ? <p role="status" className="py-8 text-center text-sm text-muted">正在讀取聯絡人…</p> : !error && contacts.length === 0 ? (
        <div className="rounded-xl border border-border bg-surface p-8 text-center"><h2 className="font-medium">目前沒有聯絡人</h2><p className="mt-2 text-sm text-muted">完成領禮電子郵件確認後，聯絡人就會顯示在這裡。</p></div>
      ) : !error ? (
        <>
          <p className="text-sm text-muted">目前顯示最新 {contacts.length.toLocaleString("zh-TW")} 筆聯絡人</p>
          <div className="space-y-3 lg:hidden">
            {contacts.map((contact) => (
              <article key={contact.id} className="space-y-3 rounded-xl border border-border p-4">
                <h2 className="break-all font-medium">{contact.email}</h2>
                <dl className="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-x-3 gap-y-2 text-sm">
                  <dt className="text-muted">Instagram／識別碼</dt><dd className="break-words">{contact.instagramUsername || "未提供帳號名稱"}</dd>
                  <dt className="text-muted">活動</dt><dd className="break-words">{contact.automationName}</dd>
                  <dt className="text-muted">電子郵件驗證</dt><dd>{contact.emailVerifiedAt ? `已確認 · ${dateLabel(contact.emailVerifiedAt)}` : "尚未確認"}</dd>
                  <dt className="text-muted">後續通知</dt><dd>{consentLabel(contact)}</dd>
                  {contact.unsubscribedAt && <><dt className="text-muted">取消時間</dt><dd>{dateLabel(contact.unsubscribedAt)}</dd></>}
                  <dt className="text-muted">Instagram 禮物</dt><dd>{giftDeliveryLabel(contact.igStatus, "instagram")}</dd>
                  <dt className="text-muted">電子郵件禮物</dt><dd>{giftDeliveryLabel(contact.emailStatus, "email")}</dd>
                  <dt className="text-muted">加入時間</dt><dd>{dateLabel(contact.createdAt)}</dd>
                </dl>
              </article>
            ))}
          </div>
          <div className="hidden overflow-x-auto rounded-xl border border-border lg:block">
            <table className="w-full min-w-[1000px] text-left text-sm">
              <caption className="sr-only">領禮聯絡人與寄送狀態</caption>
              <thead className="bg-surface text-muted"><tr>{["電子郵件", "Instagram／識別碼", "活動", "電子郵件驗證", "後續通知", "取消時間", "Instagram 禮物", "電子郵件禮物", "加入時間"].map((label) => <th key={label} scope="col" className="px-4 py-3 font-medium">{label}</th>)}</tr></thead>
              <tbody>{contacts.map((contact) => <tr key={contact.id} className="border-t border-border align-top">
                <td className="max-w-64 break-all px-4 py-3">{contact.email}</td>
                <td className="px-4 py-3">{contact.instagramUsername || "未提供"}</td>
                <td className="max-w-44 break-words px-4 py-3">{contact.automationName}</td>
                <td className="px-4 py-3">{contact.emailVerifiedAt ? <><span>已確認</span><span className="mt-1 block text-xs text-muted">{dateLabel(contact.emailVerifiedAt)}</span></> : "尚未確認"}</td>
                <td className="px-4 py-3">{consentLabel(contact)}</td>
                <td className="px-4 py-3 text-xs">{dateLabel(contact.unsubscribedAt)}</td>
                <td className="px-4 py-3">{giftDeliveryLabel(contact.igStatus, "instagram")}</td>
                <td className="px-4 py-3">{giftDeliveryLabel(contact.emailStatus, "email")}</td>
                <td className="px-4 py-3 text-xs">{dateLabel(contact.createdAt)}</td>
              </tr>)}</tbody>
            </table>
          </div>
        </>
      ) : null}
    </div>
  );
}
