import type { Metadata } from "next";
import Link from "next/link";
import LegalShell, { SERVICE_NAME, SUPPORT_EMAIL } from "@/components/legal-shell";

export const metadata: Metadata = {
  title: `隱私權說明｜${SERVICE_NAME}`,
  description:
    "說明自動回信系統如何處理 Instagram 互動、領禮 Email、驗證與寄送紀錄。",
};

export default function PrivacyPage() {
  return (
    <LegalShell
      title="隱私權說明"
      description="自動回信系統是自行架設的 OpenReply 服務，用於處理已連結 Instagram 帳號的留言與私訊活動，以及 Email 確認後的禮物寄送。"
      updatedAt="2026 年 10 月 23 日"
    >
      <section>
        <h2 className="text-xl font-bold text-foreground">處理哪些資料</h2>
        <p className="mt-3">
          我們處理後台登入 Email、工作區資料、已連結 Instagram 帳號識別資料與加密存放的存取權杖、活動設定、Instagram 事件通知、收件者識別資料、用於觸發活動的留言與私訊內容，以及確認領禮資格所需的追蹤狀態。
        </p>
        <p className="mt-3">
          啟用 Email 領禮流程時，也會處理領取者填寫的 Email、Email 驗證紀錄、後續通知的同意與取消紀錄、所屬活動，以及 Instagram 私訊與 Email 的寄送結果。另外會保留傳送紀錄、連結點擊紀錄與必要的運作診斷資料。
        </p>
      </section>

      <section>
        <h2 className="text-xl font-bold text-foreground">資料用途</h2>
        <p className="mt-3">
          這些資料用於登入驗證、連結 Instagram、比對留言與私訊關鍵字、確認追蹤狀態、驗證收信地址、透過 Meta 官方 API 與寄信服務傳送本次禮物，以及避免重複寄送、排查錯誤與維持服務運作。寄信服務接受郵件，不代表郵件已進入收件匣或已被閱讀。
        </p>
      </section>

      <section>
        <h2 className="text-xl font-bold text-foreground">領禮與後續通知分開選擇</h2>
        <p className="mt-3">
          填寫 Email 並完成確認，是用於本次禮物的地址驗證與寄送。接收徐三代後續內容與活動通知是另一個選填項目，不會預先勾選；未同意後續通知，仍可領取本次禮物。
        </p>
        <p className="mt-3">
          只有已同意且未取消的聯絡人，才可作為後續內容與活動通知的寄送對象。你可透過通知郵件中的退訂連結取消，或聯絡下方服務信箱；取消後續通知與申請刪除資料是不同操作。
        </p>
      </section>

      <section>
        <h2 className="text-xl font-bold text-foreground">Instagram 與 Meta 資料</h2>
        <p className="mt-3">
          本服務不要求提供 Instagram 密碼，也不以爬取或瀏覽器自動操作執行活動。Instagram 存取權杖會加密存放，僅用於已連結商業帳號授權的操作。
        </p>
      </section>

      <section>
        <h2 className="text-xl font-bold text-foreground">使用的服務</h2>
        <p className="mt-3">
          本部署使用 Vercel 代管網站與一般頁面流量統計、Railway 提供背景處理與資料庫／工作佇列服務、已設定的 Google Workspace／Gmail 寄信服務處理登入與領禮郵件，以及 Meta／Instagram 處理帳號連結與訊息。領禮、Email 確認及退訂頁面不啟用流量統計。
        </p>
      </section>

      <section>
        <h2 className="text-xl font-bold text-foreground">資料保留與刪除</h2>
        <p className="mt-3">
          在後台「設定」中解除指定 Instagram 帳號的連結，會移除該連結與相關活動、私訊傳送紀錄、追蹤連結、點擊紀錄及追蹤人數快照。這不等於完整刪除登入帳號、工作區或所有事件通知、診斷與工作佇列紀錄。
        </p>
        <p className="mt-3">
          Email 聯絡人名單、驗證、同意及相關寄送紀錄，不會因解除 Instagram 連結而自動全部刪除。若要申請刪除這些資料，請依{" "}
          <Link href="/data-deletion" className="text-accent underline">資料刪除說明</Link>聯絡本部署的服務信箱。
        </p>
      </section>

      <section>
        <h2 className="text-xl font-bold text-foreground">聯絡方式</h2>
        <p className="mt-3">
          如對 {SERVICE_NAME} 的資料處理有疑問，或要申請刪除資料，請聯絡本部署：{" "}
          <a href={`mailto:${SUPPORT_EMAIL}`} className="text-accent underline">{SUPPORT_EMAIL}</a>。
          OpenReply 原始開源專案的維護者不負責處理本部署的申請。
        </p>
      </section>
    </LegalShell>
  );
}
