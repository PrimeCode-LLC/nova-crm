import type { Metadata } from "next";
import { ChannelsGrid } from "@/components/marketing/channels-grid";
import { Comparison } from "@/components/marketing/comparison";
import { CtaBand } from "@/components/marketing/cta-band";
import { DashboardPreview } from "@/components/marketing/dashboard-preview";
import { FeatureList } from "@/components/marketing/feature-list";
import { Section, SectionHeading } from "@/components/marketing/section";
import { TeamAccessGovernance } from "@/components/marketing/team-access-governance";
import { TwoLayer } from "@/components/marketing/two-layer";

export const metadata: Metadata = {
  title: "Features",
  description:
    "Pipeline views, org-aware permissions and private-by-default leads, department and team policies with admin overrides, idle-lead alerts, multi-channel touchpoints, BANT stage gates, and director-level diagnostics.",
};

export default function FeaturesPage() {
  return (
    <>
      <Section className="pt-24 pb-12">
        <SectionHeading
          align="center"
          eyebrow="Features"
          title="The shortest path from lead to closed."
          description="Built specifically for teams running 6+ outbound channels with mixed permissions and a director who needs answers in 10 seconds."
        />
        <div className="mx-auto mt-14 max-w-6xl">
          <DashboardPreview />
        </div>
      </Section>

      <ChannelsGrid />
      <TwoLayer />
      <TeamAccessGovernance />
      <FeatureList />
      <Comparison />
      <CtaBand />
    </>
  );
}
