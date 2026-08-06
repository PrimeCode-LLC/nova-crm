import type { Metadata } from "next";
import { CtaBand } from "@/components/marketing/cta-band";
import { Section, SectionHeading } from "@/components/marketing/section";

export const metadata: Metadata = {
  title: "About",
  description:
    "Nova started because storing prospects is not the same as managing them. We built an intelligent system that runs every prospect journey.",
};

export default function AboutPage() {
  return (
    <>
      <Section className="pt-24 pb-12">
        <SectionHeading
          align="center"
          eyebrow="About"
          title="Built because recording activity is not enough."
          description="Nova comes from Stellix Soft — a team that lived the gap between CRM records, rigid sequencers, and the real work of moving prospects forward with judgment."
        />
      </Section>

      <Section className="py-12">
        <div className="mx-auto grid max-w-5xl gap-10 md:grid-cols-2">
          <Block
            title="The problem"
            body="Teams already had CRMs, inboxes, and automation tools. What they lacked was a system that understands each prospect, decides the next move, and executes most of the journey without constant babysitting."
          />
          <Block
            title="The insight"
            body="A CRM tells you what happened. A sequencer fires what you pre-wrote. Revenue teams need something that interprets replies, adapts sequences, and grounds every message in real company knowledge."
          />
          <Block
            title="The product"
            body="Nova is an AI revenue execution system: personalized journeys, adaptive follow-ups, reply intelligence, RAG-powered knowledge, engagement signals, and content from one connected layer."
          />
          <Block
            title="The standard"
            body="Every prospect should feel individually managed. Automation without judgment is spam. Intelligence without execution is a dashboard. Nova is designed to do both."
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
