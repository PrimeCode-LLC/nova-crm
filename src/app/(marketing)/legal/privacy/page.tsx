import type { Metadata } from "next";
import { Section } from "@/components/marketing/section";
import { Prose } from "@/components/marketing/prose";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: "How Nova CRM collects, uses, and protects your data.",
};

const UPDATED = "May 2, 2026";

export default function PrivacyPage() {
  return (
    <Section className="pt-24" containerClassName="max-w-3xl">
      <p className="text-sm text-muted-foreground">Last updated: {UPDATED}</p>
      <h1 className="mt-2 text-4xl font-semibold tracking-tight">
        Privacy Policy
      </h1>

      <Prose className="mt-8">
        <p>
          This is a placeholder privacy policy. Replace before public launch
          with a lawyer-reviewed version specific to your jurisdiction(s) and
          data flows.
        </p>

        <h2>What we collect</h2>
        <ul>
          <li>Account data (name, email, company, role)</li>
          <li>Lead and CRM content you enter into the product</li>
          <li>Operational telemetry (page views, feature usage, error logs)</li>
          <li>Billing identifiers from our payment processor</li>
        </ul>

        <h2>How we use it</h2>
        <p>
          We use your data to operate the service, support you, and improve the
          product. We do not sell your data. We do not use your CRM content to
          train AI models.
        </p>

        <h2>Sub-processors</h2>
        <p>
          We rely on a small set of vendors (hosting, email delivery, error
          reporting). The current list is available on request.
        </p>

        <h2>Your rights</h2>
        <p>
          You can export, correct, or delete your data at any time. Email{" "}
          <a href="mailto:privacy@novacrm.com">privacy@novacrm.com</a>.
        </p>
      </Prose>
    </Section>
  );
}
