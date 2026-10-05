import type { Metadata } from "next";
import LegalShell, { SERVICE_NAME, SUPPORT_EMAIL } from "@/components/legal-shell";

export const metadata: Metadata = {
  title: `Data Deletion - ${SERVICE_NAME}`,
  description:
    "How to disconnect Instagram and request account or campaign data deletion from 自動回信系統.",
};

export default function DataDeletionPage() {
  return (
    <LegalShell
      title="Data Deletion"
      description="Instructions for requesting removal of account, workspace, Instagram, and campaign data held by 自動回信系統 (OpenReply self-hosted)."
      updatedAt="October 5, 2026"
    >
      <section>
        <h2 className="text-xl font-bold text-foreground">Disconnect Instagram</h2>
        <p className="mt-3">
          Sign in, open Settings, and select Disconnect for the Instagram account
          you want to remove. This deletes that account&apos;s stored connection
          token and associated campaigns, delivery logs, tracked links, click
          records, and follower snapshots from the application database.
          Messages already delivered on Instagram are not removed by this action.
        </p>
        <p className="mt-3">
          Disconnect is not full account deletion. Your sign-in account,
          workspace, and webhook, diagnostic, or queue records may remain.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-bold text-foreground">Request Data Deletion</h2>
        <p className="mt-3">
          Email{" "}
          <a href={`mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(`${SERVICE_NAME} 資料刪除申請`)}`} className="text-accent underline">{SUPPORT_EMAIL}</a>
          {" "}with the subject &ldquo;{SERVICE_NAME} 資料刪除申請&rdquo;.
          Include the Instagram username and the data you want removed. If you
          manage a workspace, include its name and send the request from the
          email address used to sign in. Requests are handled manually by this
          deployment&apos;s support contact, including review of remaining
          account, workspace, webhook, diagnostic, and queue records.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-bold text-foreground">Verification</h2>
        <p className="mt-3">
          We may ask you to verify control of the email address or connected
          business account before deleting data. Deletion requests are processed
          as quickly as practical unless retention is required for legal,
          billing, fraud prevention, or security reasons.
        </p>
      </section>
    </LegalShell>
  );
}
