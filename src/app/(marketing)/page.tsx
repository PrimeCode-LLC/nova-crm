import type { Metadata } from "next";
import { PremiumLanding } from "@/components/marketing/premium-landing";
import { SITE } from "@/lib/site";

export const metadata: Metadata = {
  title: "Nova books the meetings",
  description: SITE.description,
};

export default function LandingPage() {
  return <PremiumLanding />;
}
