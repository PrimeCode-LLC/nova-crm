import type { Metadata } from "next";
import { Comparison } from "@/components/marketing/comparison";
import { CtaBand } from "@/components/marketing/cta-band";
import { DashboardPreview } from "@/components/marketing/dashboard-preview";
import { IntelligencePillars } from "@/components/marketing/intelligence-pillars";
import { JourneySteps } from "@/components/marketing/journey-steps";
import { KnowledgeRag } from "@/components/marketing/knowledge-rag";
import { NotAnotherCrm } from "@/components/marketing/not-another-crm";
import { ReplyIntelligence } from "@/components/marketing/reply-intelligence";
import { Section, SectionHeading } from "@/components/marketing/section";
import { SITE } from "@/lib/site";

export const metadata: Metadata = {
  title: "Features",
  description:
    "Adaptive sequences, reply intelligence, RAG-grounded outreach, engagement signals, Intent Radar, Fit Check, and connected content — the Nova revenue execution stack.",
};

export default function FeaturesPage() {
  return (
    <>
      <Section className="pt-24 pb-12">
        <SectionHeading
          align="center"
          eyebrow="Features"
          title="The intelligence layer that runs every prospect journey."
          description={SITE.oneLiner}
        />
        <div className="mx-auto mt-14 max-w-6xl">
          <DashboardPreview />
        </div>
      </Section>

      <NotAnotherCrm />
      <JourneySteps />
      <IntelligencePillars />
      <ReplyIntelligence />
      <KnowledgeRag />
      <Comparison />
      <CtaBand />
    </>
  );
}
