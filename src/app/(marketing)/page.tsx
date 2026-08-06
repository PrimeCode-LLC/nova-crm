import type { Metadata } from "next";
import { Comparison } from "@/components/marketing/comparison";
import { CtaBand } from "@/components/marketing/cta-band";
import { Hero } from "@/components/marketing/hero";
import { IntelligencePillars } from "@/components/marketing/intelligence-pillars";
import { JourneySteps } from "@/components/marketing/journey-steps";
import { KnowledgeRag } from "@/components/marketing/knowledge-rag";
import { NotAnotherCrm } from "@/components/marketing/not-another-crm";
import { ReplyIntelligence } from "@/components/marketing/reply-intelligence";
import { SITE } from "@/lib/site";

export const metadata: Metadata = {
  title: "AI Revenue Execution System",
  description: SITE.description,
};

export default function LandingPage() {
  return (
    <>
      <Hero />
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
