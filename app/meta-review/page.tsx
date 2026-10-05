import type { Metadata } from "next";
import LegalShell, { SERVICE_NAME } from "@/components/legal-shell";

export const metadata: Metadata = {
  title: `Meta App Review Support - ${SERVICE_NAME}`,
  description:
    "Meta review notes for 自動回信系統 and its Instagram private reply workflow.",
};

export default function MetaReviewPage() {
  return (
    <LegalShell
      title="Meta App Review Support"
      description="自動回信系統 is a self-hosted OpenReply deployment for keyword-triggered replies on connected Instagram professional accounts."
      updatedAt="October 5, 2026"
    >
      <section>
        <h2 className="text-xl font-bold text-foreground">User Flow</h2>
        <p className="mt-3">
          A business owner signs in by email, connects an Instagram professional
          account through Meta OAuth, creates a keyword campaign for a post or
          reel, and receives a webhook when someone comments. The service queues
          the event, deduplicates it, and checks rate limits. This deployment
          requires confirmed follow status before delivering gift content or
          links. A recipient can receive a fixed follow prompt and tap its
          confirmation button; when Instagram cannot confirm the follow, the
          gift is withheld.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-bold text-foreground">API Access Prerequisites</h2>
        <p className="mt-3">
          Before testing comment delivery, verify the permissions, access level,
          app mode, and webhook subscriptions required by Meta&apos;s current{" "}
          <a href="https://developers.facebook.com/documentation/instagram-platform/webhooks/setup" className="text-accent underline">webhook setup documentation</a>.
          Connecting an account alone does not establish comment webhook access,
          App Review approval, or successful live follower verification.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-bold text-foreground">API Handling</h2>
        <p className="mt-3">
          The app uses official Meta APIs, verifies webhook signatures, encrypts
          tokens, avoids scraping, avoids password collection, and sends no more
          than one private reply for a matched campaign/comment pair.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-bold text-foreground">Review Test Notes</h2>
        <p className="mt-3">
          Once the required access is available, use an authorized Instagram
          professional account and a separate recipient account to test a
          campaign keyword such as LINK. Confirm that a non-follower does not
          receive the gift, then follow the connected account and tap the
          confirmation button. Verify the resulting delivery and logs. These
          are test instructions, not a claim that this live test has passed.
        </p>
      </section>
    </LegalShell>
  );
}
