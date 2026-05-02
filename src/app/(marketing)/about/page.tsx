import type { Metadata } from "next";
import { CtaBand } from "@/components/marketing/cta-band";
import { Section, SectionHeading } from "@/components/marketing/section";

export const metadata: Metadata = {
  title: "About",
  description:
    "We built Nova CRM because every existing CRM forced our team to deform our workflow. So we replaced the spreadsheet at the center.",
};

export default function AboutPage() {
  return (
    <>
      <Section className="pt-24 pb-12">
        <SectionHeading
          align="center"
          eyebrow="About"
          title="We built the CRM we wanted to use."
          description="Nova started as the internal tool we built for our own sales team. After running it for six months across cold email, LinkedIn, Upwork, inbound, and 1:1 outreach, we realized other teams had the same problem."
        />
      </Section>

      <Section className="py-12">
        <div className="mx-auto grid max-w-5xl gap-10 md:grid-cols-2">
          <Block
            title="The story"
            body="We were running a 12-person sales team across six channels with one shared Google Sheet. n8n watched the sheet, Instantly ran the campaigns, and someone (always the wrong person) fielded the inbound replies. Things fell through the cracks every week."
          />
          <Block
            title="The insight"
            body="Generic CRMs force a single funnel onto every channel. Spreadsheets don't enforce permissions. Neither tracks the effort that creates the leads. We needed both: funnels per channel and one converged closing pipeline, with effort and intent as separate layers."
          />
          <Block
            title="The principle"
            body="The system should be fully usable on day one without integrations. Manual entry is a first-class citizen. Integrations come online over weeks and months, they're upgrades, never preconditions."
          />
          <Block
            title="The bet"
            body="If you can answer 'why did closings drop this month?' in ten seconds, you'll fix problems weeks earlier. That single capability (diagnosis without spreadsheet archaeology) pays for the whole tool."
          />
        </div>
      </Section>

      <CtaBand />
    </>
  );
}

function Block({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-2xl border border-border/60 bg-card/60 p-6 backdrop-blur-sm">
      <h3 className="font-semibold">{title}</h3>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
        {body}
      </p>
    </div>
  );
}
