import type { Metadata } from "next";
import { ChannelsGrid } from "@/components/marketing/channels-grid";
import { Comparison } from "@/components/marketing/comparison";
import { CtaBand } from "@/components/marketing/cta-band";
import { FeatureList } from "@/components/marketing/feature-list";
import { Hero } from "@/components/marketing/hero";
import { TeamAccessGovernance } from "@/components/marketing/team-access-governance";
import { TwoLayer } from "@/components/marketing/two-layer";

export const metadata: Metadata = {
  title: "Multi-channel Sales CRM",
  description:
    "Replace Sheets with a CRM built for teams running cold email, LinkedIn, Upwork, and inbound. Private-by-default leads, department and team visibility, admin policies with overrides, plus per-channel funnels and director-level diagnostics.",
};

export default function LandingPage() {
  return (
    <>
      <Hero />
      <ChannelsGrid />
      <TwoLayer />
      <TeamAccessGovernance />
      <FeatureList />
      <Comparison />
      <CtaBand />
    </>
  );
}
