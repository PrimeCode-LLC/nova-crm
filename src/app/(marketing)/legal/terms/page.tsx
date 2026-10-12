import type { Metadata } from "next";
import { Section } from "@/components/marketing/section";
import { Prose } from "@/components/marketing/prose";
import { SITE } from "@/lib/site";

export const metadata: Metadata = {
  title: "Terms of Service",
  description: "The terms governing your use of Nova.",
};

const UPDATED = "October 12, 2026";
const OPERATOR = "Stellix Soft LLC";
const CONTACT = SITE.salesEmail;

export default function TermsPage() {
  return (
    <Section className="pt-24" containerClassName="max-w-3xl">
      <p className="text-sm text-muted-foreground">Last updated: {UPDATED}</p>
      <h1 className="mt-2 text-4xl font-semibold tracking-tight">
        Terms of Service
      </h1>

      <Prose className="mt-8">
        <p>
          These Terms of Service (&quot;Terms&quot;) govern access to and use of{" "}
          {SITE.name} (the &quot;Service&quot;) operated by {OPERATOR}{" "}
          (&quot;Stellix Soft,&quot; &quot;we,&quot; &quot;us,&quot; or
          &quot;our&quot;). By creating an account, accessing the Service, or
          clicking to accept these Terms, you agree to be bound by them.
        </p>
        <p>
          If you use the Service on behalf of an organization, you represent
          that you have authority to bind that organization, and &quot;you&quot;
          refers to that organization.
        </p>

        <h2>1. The Service</h2>
        <p>
          {SITE.name} is a hosted software platform for B2B revenue workflows,
          including CRM-style records, outbound and follow-up tooling,
          integrations, and AI-assisted features. We may add, change, or remove
          features, including beta or early-access capabilities, with reasonable
          notice when material changes affect paid plans.
        </p>

        <h2>2. Accounts and eligibility</h2>
        <ul>
          <li>
            You must provide accurate registration information and keep it
            current.
          </li>
          <li>
            You are responsible for all activity under your account and for
            keeping credentials and API keys confidential.
          </li>
          <li>
            Organization admins are responsible for user access within their
            workspace and for configuring roles appropriately.
          </li>
          <li>
            You must be at least 16 years old (or the age of digital consent in
            your jurisdiction) to use the Service.
          </li>
        </ul>

        <h2>3. Customer data and licenses</h2>
        <p>
          You retain ownership of content and data you submit to the Service
          (&quot;Customer Data&quot;). You grant us a limited license to host,
          process, transmit, and display Customer Data solely to provide and
          secure the Service, and as otherwise described in our{" "}
          <a href="/legal/privacy">Privacy Policy</a>.
        </p>
        <p>
          You represent that you have all rights and consents needed to submit
          Customer Data (including prospect and contact information) and to use
          connected inboxes, calendars, or other integrations.
        </p>

        <h2>4. Acceptable use</h2>
        <p>You agree not to:</p>
        <ul>
          <li>
            Use the Service to send unlawful, deceptive, or unsolicited bulk
            communications in violation of applicable anti-spam, privacy, or
            marketing laws
          </li>
          <li>
            Scrape, harvest, or store personal data unlawfully, or use the
            Service to violate third-party rights
          </li>
          <li>
            Attempt to gain unauthorized access, disrupt, reverse engineer
            (except where permitted by law), or overload the Service
          </li>
          <li>
            Upload malware, or use the Service for illegal, harmful, or abusive
            activity
          </li>
          <li>
            Misrepresent affiliation with {SITE.name} or use our branding without
            permission
          </li>
        </ul>
        <p>
          We may suspend or terminate access for violations, suspected abuse, or
          risk to the Service or other users.
        </p>

        <h2>5. Email, outreach, and compliance</h2>
        <p>
          Outbound email and messaging features are tools you control. You are
          solely responsible for content you send, list quality, consent or
          legitimate-interest bases, unsubscribe handling, and compliance with
          CAN-SPAM, CASL, GDPR, and other applicable laws. We do not guarantee
          deliverability.
        </p>

        <h2>6. AI features</h2>
        <p>
          AI-generated suggestions, drafts, classifications, and similar outputs
          may be inaccurate or incomplete. You must review outputs before relying
          on them or sending them to third parties. AI features may process
          Customer Data as described in the Privacy Policy.
        </p>

        <h2>7. Third-party services</h2>
        <p>
          The Service may integrate with third parties (for example identity
          providers, email providers, calendars, or payment processors). Your
          use of those services is subject to their terms. We are not
          responsible for third-party products or for outages outside our
          reasonable control.
        </p>

        <h2>8. Fees and payment</h2>
        <p>
          Paid plans are billed according to the pricing presented at purchase
          or in an order form. Fees are non-refundable except where required by
          law or expressly stated otherwise. We may change prices with notice
          before the next renewal period. Failure to pay may result in
          suspension.
        </p>

        <h2>9. Intellectual property</h2>
        <p>
          The Service, including software, design, documentation, and branding,
          is owned by {OPERATOR} and its licensors. These Terms do not grant you
          any rights to our trademarks or source code except the limited right
          to use the Service as permitted.
        </p>

        <h2>10. Confidentiality</h2>
        <p>
          Each party may receive confidential information from the other. The
          receiving party will use it only for purposes of these Terms and
          protect it with reasonable care, except for information that is
          public, independently developed, or required to be disclosed by law.
        </p>

        <h2>11. Termination</h2>
        <p>
          You may stop using the Service and cancel your subscription according
          to your plan settings or by contacting us. We may terminate or suspend
          the Service or your account for material breach, non-payment, or legal
          risk. Upon termination, your right to access the Service ends. We
          handle Customer Data as described in the Privacy Policy (including a
          limited post-cancellation retention window where applicable).
        </p>

        <h2>12. Disclaimers</h2>
        <p>
          THE SERVICE IS PROVIDED &quot;AS IS&quot; AND &quot;AS
          AVAILABLE.&quot; TO THE MAXIMUM EXTENT PERMITTED BY LAW, WE DISCLAIM
          ALL WARRANTIES, EXPRESS OR IMPLIED, INCLUDING MERCHANTABILITY,
          FITNESS FOR A PARTICULAR PURPOSE, AND NON-INFRINGEMENT. WE DO NOT
          WARRANT THAT THE SERVICE WILL BE UNINTERRUPTED, ERROR-FREE, OR THAT
          AI OUTPUTS WILL MEET YOUR REQUIREMENTS.
        </p>

        <h2>13. Limitation of liability</h2>
        <p>
          TO THE MAXIMUM EXTENT PERMITTED BY LAW, {OPERATOR} AND ITS AFFILIATES
          WILL NOT BE LIABLE FOR INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL,
          OR PUNITIVE DAMAGES, OR FOR LOST PROFITS, REVENUE, DATA, OR GOODWILL.
          OUR AGGREGATE LIABILITY ARISING OUT OF OR RELATED TO THE SERVICE WILL
          NOT EXCEED THE AMOUNTS YOU PAID TO US FOR THE SERVICE IN THE TWELVE
          (12) MONTHS BEFORE THE CLAIM. SOME JURISDICTIONS DO NOT ALLOW CERTAIN
          LIMITATIONS; IN THOSE CASES, OUR LIABILITY IS LIMITED TO THE FULLEST
          EXTENT PERMITTED.
        </p>

        <h2>14. Indemnification</h2>
        <p>
          You will defend and indemnify {OPERATOR} against claims arising from
          your Customer Data, your use of the Service in violation of these
          Terms or law, or your outbound communications and prospecting
          practices.
        </p>

        <h2>15. Changes to the Terms</h2>
        <p>
          We may update these Terms by posting a revised version on this page
          and updating the &quot;Last updated&quot; date. Material changes for
          paid customers will be communicated with reasonable notice where
          practicable. Continued use after the effective date constitutes
          acceptance.
        </p>

        <h2>16. Governing law</h2>
        <p>
          These Terms are governed by the laws of the State of Delaware, USA,
          without regard to conflict-of-law principles, unless mandatory local
          consumer law requires otherwise. Courts located in Delaware will have
          exclusive jurisdiction, except where prohibited.
        </p>

        <h2>17. Contact</h2>
        <p>
          {OPERATOR}
          <br />
          Questions about these Terms:{" "}
          <a href={`mailto:${CONTACT}`}>{CONTACT}</a>
          <br />
          Privacy Policy:{" "}
          <a href="/legal/privacy">
            {SITE.url}/legal/privacy
          </a>
        </p>
      </Prose>
    </Section>
  );
}
