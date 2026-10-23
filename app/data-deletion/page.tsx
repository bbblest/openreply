import type { Metadata } from "next";
import LegalShell, { SERVICE_NAME, SUPPORT_EMAIL } from "@/components/legal-shell";

export const metadata: Metadata = {
  title: `資料刪除說明｜${SERVICE_NAME}`,
  description:
    "說明如何解除 Instagram 連結，以及申請刪除帳號、Email 名單、驗證與活動資料。",
};

export default function DataDeletionPage() {
  return (
    <LegalShell
      title="資料刪除說明"
      description="你可以申請刪除自動回信系統保管的帳號、工作區、Instagram、Email 聯絡人與活動相關資料。"
      updatedAt="2026 年 10 月 23 日"
    >
      <section>
        <h2 className="text-xl font-bold text-foreground">解除 Instagram 連結</h2>
        <p className="mt-3">
          登入後台，開啟「設定」，選擇要移除的 Instagram 帳號並解除連結。這會從應用程式資料庫刪除該帳號的連結權杖與相關活動、私訊傳送紀錄、追蹤連結、點擊紀錄及追蹤人數快照。已送達 Instagram 的訊息不會因此撤回。
        </p>
        <p className="mt-3">
          解除連結不等於完整刪除資料。登入帳號、工作區、Email 聯絡人名單、驗證與通知同意紀錄，以及事件通知、診斷或工作佇列等資料可能仍保留。已寄出的 Email 也不會因此撤回。
        </p>
      </section>

      <section>
        <h2 className="text-xl font-bold text-foreground">申請刪除資料</h2>
        <p className="mt-3">
          請寄信至{" "}
          <a href={`mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(`${SERVICE_NAME} 資料刪除申請`)}`} className="text-accent underline">{SUPPORT_EMAIL}</a>
          ，主旨填寫「{SERVICE_NAME} 資料刪除申請」。請說明使用的 Instagram 帳號、領禮 Email，以及希望刪除的資料範圍，例如聯絡人名單、驗證紀錄、通知同意紀錄或寄送紀錄。
        </p>
        <p className="mt-3">
          若你是工作區管理者，請一併提供工作區名稱，並使用後台登入 Email 提出申請。本部署的服務人員會人工核對申請與相關資料，包括仍保留的帳號、工作區、Email、事件通知、診斷及工作佇列紀錄。
        </p>
      </section>

      <section>
        <h2 className="text-xl font-bold text-foreground">身分核對與取消通知</h2>
        <p className="mt-3">
          刪除前可能需要你確認 Email 或相關 Instagram 帳號的使用權，以避免他人冒名申請。請不要提供帳號密碼。
        </p>
        <p className="mt-3">
          如果只是要停止徐三代後續內容與活動通知，可使用通知郵件中的退訂連結，或寄信到上述服務信箱。取消後續通知不等於刪除 Email 名單與本次禮物的驗證、寄送紀錄；如需刪除，請另外提出申請。
        </p>
      </section>
    </LegalShell>
  );
}
