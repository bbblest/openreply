import type { Metadata } from "next";
import LegalShell, { SERVICE_NAME } from "@/components/legal-shell";

export const metadata: Metadata = {
  title: `Terms of Service - ${SERVICE_NAME}`,
  description:
    "Terms for using 自動回信系統, a self-hosted OpenReply service.",
};

export default function TermsPage() {
  return (
    <LegalShell
      title="Terms of Service"
      description="These terms describe use of 自動回信系統, this self-hosted OpenReply Instagram comment-to-DM service."
      updatedAt="October 5, 2026"
    >
      <section>
        <h2 className="text-xl font-bold text-foreground">Authorized Use</h2>
        <p className="mt-3">
          You may use this service only with Instagram professional accounts you
          own or are authorized to manage. You are responsible for the campaigns,
          keywords, links, and messages you configure.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-bold text-foreground">Platform Compliance</h2>
        <p className="mt-3">
          You agree to follow Meta Platform Terms, Instagram policies, applicable
          messaging rules, privacy laws, advertising rules, and anti-spam laws.
          This service may rate-limit, pause, or disable campaigns that create
          compliance, abuse, security, or deliverability risk.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-bold text-foreground">Availability</h2>
        <p className="mt-3">
          This service depends on third-party platforms including Meta, email,
          hosting, database, and queue providers. We work to operate the
          service reliably, but uninterrupted availability is not guaranteed.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-bold text-foreground">Open-Source Core</h2>
        <p className="mt-3">
          This deployment uses the MIT-licensed OpenReply project. The upstream
          project and this self-hosted service are separate; use the contact
          address below for support or data deletion requests for this service.
        </p>
      </section>
    </LegalShell>
  );
}
