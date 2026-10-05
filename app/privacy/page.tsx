import type { Metadata } from "next";
import Link from "next/link";
import LegalShell, { SERVICE_NAME, SUPPORT_EMAIL } from "@/components/legal-shell";

export const metadata: Metadata = {
  title: `Privacy Policy - ${SERVICE_NAME}`,
  description:
    "How 自動回信系統 handles Instagram account data, webhook payloads, and campaign information.",
};

export default function PrivacyPage() {
  return (
    <LegalShell
      title="Privacy Policy"
      description="自動回信系統 is a self-hosted OpenReply service for private replies to comments on connected Instagram posts or reels."
      updatedAt="October 5, 2026"
    >
      <section>
        <h2 className="text-xl font-bold text-foreground">Data We Collect</h2>
        <p className="mt-3">
          We collect account email addresses for authentication, workspace
          metadata, connected Instagram account identifiers, encrypted
          Instagram access tokens, campaign settings, webhook payloads,
          recipient identifiers, comments and message content used to trigger
          campaigns, follow status needed to verify gift eligibility, delivery
          logs, link click records, and operational diagnostics.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-bold text-foreground">How We Use Data</h2>
        <p className="mt-3">
          We use this data to authenticate users, connect Instagram
          integrations, match campaign keywords in comments and messages, check
          that recipients follow the connected account before releasing gifts,
          send private replies through the official Meta APIs, prevent duplicate
          sends, troubleshoot failures, and protect the service.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-bold text-foreground">Instagram And Meta Data</h2>
        <p className="mt-3">
          This service does not ask for Instagram passwords, scrape Instagram, or
          use browser automation. Instagram tokens are encrypted at rest and are
          used only to perform actions authorized by the connected business
          account.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-bold text-foreground">Subprocessors</h2>
        <p className="mt-3">
          This deployment uses Vercel for hosting and analytics, Railway for
          database and queue services, Google Workspace/Gmail for authentication
          emails, and Meta/Instagram for account integration and messaging.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-bold text-foreground">Retention And Deletion</h2>
        <p className="mt-3">
          Disconnecting a selected Instagram account in Settings removes its
          stored connection and associated campaigns, delivery logs, tracked
          links, click records, and follower snapshots from the application
          database. It does not delete the sign-in account, workspace, or all
          webhook, diagnostic, and queue records. For a full data deletion
          request, follow the{" "}
          <Link href="/data-deletion" className="text-accent underline">Data Deletion instructions</Link>.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-bold text-foreground">Contact</h2>
        <p className="mt-3">
          For privacy questions or data deletion requests about {SERVICE_NAME},
          contact this deployment at{" "}
          <a href={`mailto:${SUPPORT_EMAIL}`} className="text-accent underline">{SUPPORT_EMAIL}</a>.
          The upstream OpenReply repository owner does not handle requests for
          this deployment.
        </p>
      </section>
    </LegalShell>
  );
}
