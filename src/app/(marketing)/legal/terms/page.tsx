import type { Metadata } from "next";
import { Section } from "@/components/marketing/section";
import { Prose } from "@/components/marketing/prose";

export const metadata: Metadata = {
  title: "Terms of Service",
  description: "The terms governing your use of Nova.",
};

const UPDATED = "May 2, 2026";

export default function TermsPage() {
  return (
    <Section className="pt-24" containerClassName="max-w-3xl">
      <p className="text-sm text-muted-foreground">Last updated: {UPDATED}</p>
      <h1 className="mt-2 text-4xl font-semibold tracking-tight">
        Terms of Service
      </h1>

      <Prose className="mt-8">
        <p>
          This is a placeholder terms of service. Replace before public launch
          with a lawyer-reviewed version.
        </p>

        <h2>Service</h2>
        <p>
          Nova provides a hosted AI revenue execution system for prospect
          journeys. We may update features, pricing, or limits with reasonable
          notice.
        </p>

        <h2>Your account</h2>
        <p>
          You're responsible for activity on your account, for keeping
          credentials private, and for the data you put into the product.
        </p>

        <h2>Acceptable use</h2>
        <p>
          Don't use Nova to send unsolicited bulk email outside of permitted
          frameworks, scrape or store data unlawfully, or attempt to disrupt the
          service. We may suspend accounts that do.
        </p>

        <h2>Termination</h2>
        <p>
          You can cancel any time from settings. We retain account data for 30
          days after cancellation, then delete it.
        </p>

        <h2>Liability</h2>
        <p>
          The service is provided as-is. Our maximum liability is limited to
          fees paid in the prior 12 months.
        </p>
      </Prose>
    </Section>
  );
}
