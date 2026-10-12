import type { Metadata } from "next";
import { Section } from "@/components/marketing/section";
import { Prose } from "@/components/marketing/prose";
import { SITE } from "@/lib/site";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: "How Nova collects, uses, and protects your data.",
};

const UPDATED = "October 12, 2026";
const OPERATOR = "Stellix Soft LLC";
const CONTACT = SITE.salesEmail;

export default function PrivacyPage() {
  return (
    <Section className="pt-24" containerClassName="max-w-3xl">
      <p className="text-sm text-muted-foreground">Last updated: {UPDATED}</p>
      <h1 className="mt-2 text-4xl font-semibold tracking-tight">
        Privacy Policy
      </h1>

      <Prose className="mt-8">
        <p>
          This Privacy Policy explains how {OPERATOR} (&quot;Stellix Soft,&quot;
          &quot;we,&quot; &quot;us,&quot; or &quot;our&quot;) collects, uses,
          shares, and protects information when you use {SITE.name} (the
          &quot;Service&quot;), including our website, application, APIs, and
          related services.
        </p>
        <p>
          By using the Service, you agree to this Privacy Policy. If you do not
          agree, do not use the Service.
        </p>

        <h2>1. Who we are</h2>
        <p>
          {SITE.name} is operated by {OPERATOR}. For privacy questions or
          requests, contact us at{" "}
          <a href={`mailto:${CONTACT}`}>{CONTACT}</a>.
        </p>

        <h2>2. Information we collect</h2>
        <h3>Account and profile information</h3>
        <ul>
          <li>
            Name, email address, organization name, role, and authentication
            identifiers (including via our identity provider)
          </li>
          <li>
            Billing and subscription details processed by our payment provider
            (we do not store full payment card numbers)
          </li>
        </ul>

        <h3>Customer CRM and workspace content</h3>
        <ul>
          <li>
            Leads, prospects, accounts, contacts, notes, tasks, pipelines, and
            other records you or your team enter into the Service
          </li>
          <li>
            Email content, templates, sequences, calendar events, and related
            metadata when you connect or use those features
          </li>
          <li>
            Files, knowledge-base content, and other materials you upload for
            product features such as personalization or AI assistance
          </li>
        </ul>

        <h3>Connected services</h3>
        <p>
          If you connect third-party accounts (for example Google for Gmail or
          Calendar), we receive the data necessary to provide the integration,
          subject to your permissions and the third party&apos;s terms.
        </p>

        <h3>Usage, device, and technical data</h3>
        <ul>
          <li>
            Log data such as IP address, browser type, device information,
            timestamps, and pages or features accessed
          </li>
          <li>
            Product telemetry (feature usage, performance metrics, and error
            reports) used to operate and improve the Service
          </li>
          <li>
            Cookies and similar technologies needed for authentication,
            security, preferences, and basic analytics
          </li>
        </ul>

        <h3>Communications</h3>
        <p>
          When you contact us (sales, support, waitlist, or demo requests), we
          keep the information you provide so we can respond and follow up.
        </p>

        <h2>3. How we use information</h2>
        <p>We use information to:</p>
        <ul>
          <li>Provide, maintain, secure, and improve the Service</li>
          <li>
            Authenticate users, manage organizations, and enforce access
            controls
          </li>
          <li>
            Send transactional messages (invites, security alerts, product
            notices)
          </li>
          <li>
            Power features you enable, including outbound workflows, email
            sending/tracking where configured, reply handling, and AI-assisted
            suggestions grounded in your workspace content
          </li>
          <li>Process billing and prevent fraud or abuse</li>
          <li>Comply with law and respond to lawful requests</li>
        </ul>
        <p>
          We do not sell your personal information. We do not use your CRM
          content or connected mailbox content to train foundation models for
          unrelated third parties.
        </p>

        <h2>4. AI features</h2>
        <p>
          Some {SITE.name} features use artificial intelligence to generate
          suggestions, summarize content, or assist workflows. When those
          features run, relevant workspace content may be processed by our
          systems and carefully selected AI providers solely to deliver the
          feature you requested. You remain responsible for reviewing AI output
          before sending it externally.
        </p>

        <h2>5. How we share information</h2>
        <p>We may share information with:</p>
        <ul>
          <li>
            <strong>Service providers</strong> that help us host, authenticate,
            deliver email, process payments, monitor errors, or provide AI
            inference — bound by contractual obligations to protect data
          </li>
          <li>
            <strong>Your organization admins</strong>, who can manage users and
            workspace content within your tenant
          </li>
          <li>
            <strong>Professional advisors</strong> (legal, accounting) when
            needed
          </li>
          <li>
            <strong>Authorities</strong> when required by law or to protect
            rights, safety, or the integrity of the Service
          </li>
          <li>
            <strong>Successors</strong> in connection with a merger,
            acquisition, or asset transfer, subject to appropriate protections
          </li>
        </ul>

        <h2>6. Data retention</h2>
        <p>
          We retain account and workspace data while your organization is
          active. After cancellation or deletion requests, we generally retain
          data for a limited period (typically up to 30 days) for recovery and
          legal/compliance needs, then delete or anonymize it from active
          systems, except where longer retention is required by law or for
          dispute resolution, security, or backup integrity.
        </p>

        <h2>7. Security</h2>
        <p>
          We use industry-standard measures appropriate to the nature of the
          data, including encryption in transit, access controls, and tenant
          isolation practices. No method of transmission or storage is fully
          secure; you are responsible for safeguarding credentials and
          configuring integrations appropriately.
        </p>

        <h2>8. International transfers</h2>
        <p>
          We may process information in the United States and other countries
          where we or our providers operate. Where required, we use appropriate
          safeguards for cross-border transfers.
        </p>

        <h2>9. Your rights and choices</h2>
        <p>
          Depending on your location, you may have rights to access, correct,
          export, or delete personal information, or to object to or restrict
          certain processing. To exercise these rights, email{" "}
          <a href={`mailto:${CONTACT}`}>{CONTACT}</a>. We may need to verify
          your identity and, for organization data, coordinate with your
          workspace admin.
        </p>
        <p>
          You can disconnect third-party integrations from the product settings
          (where available) and control marketing emails via unsubscribe links.
        </p>

        <h2>10. Children</h2>
        <p>
          The Service is not directed to children under 16, and we do not
          knowingly collect personal information from them. If you believe a
          child has provided information, contact us and we will take
          appropriate steps.
        </p>

        <h2>11. Changes to this policy</h2>
        <p>
          We may update this Privacy Policy from time to time. We will post the
          revised version on this page and update the &quot;Last updated&quot;
          date. Continued use of the Service after changes become effective
          constitutes acceptance of the updated policy.
        </p>

        <h2>12. Contact</h2>
        <p>
          {OPERATOR}
          <br />
          Privacy inquiries:{" "}
          <a href={`mailto:${CONTACT}`}>{CONTACT}</a>
          <br />
          Website:{" "}
          <a href={SITE.url}>{SITE.url}</a>
        </p>
      </Prose>
    </Section>
  );
}
