import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CtaBand } from "@/components/marketing/cta-band";
import { Section, SectionHeading } from "@/components/marketing/section";
import { WaitlistForm } from "@/components/marketing/waitlist-form";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Pricing",
  description:
    "Join the Nova waitlist for early access. Plans for operators, revenue teams, and scaled outbound organizations.",
};

const TIERS = [
  {
    name: "Operator",
    price: "Waitlist",
    cadence: "early access",
    description:
      "For founders and lean GTM operators who want intelligent journeys without a heavy CRM rollout.",
    cta: "Join waitlist",
    href: "#waitlist",
    highlight: false,
    features: [
      "Personalized AI sequences",
      "Reply intelligence & drafts",
      "RAG company knowledge",
      "Engagement signals",
      "Prospect & lead workspace",
      "Email waitlist onboarding",
    ],
  },
  {
    name: "Revenue Team",
    price: "Custom",
    cadence: "per seat · talk to us",
    description:
      "For teams that need shared intelligence, mailbox capacity, and governed outbound execution.",
    cta: "Talk to sales",
    href: "/contact",
    highlight: true,
    features: [
      "Everything in Operator",
      "Team visibility & ownership",
      "Adaptive multi-step campaigns",
      "OOO / referral / opt-out handling",
      "Intent Radar + Fit Check",
      "Connected content engine",
      "Priority onboarding",
    ],
  },
  {
    name: "Scale",
    price: "Enterprise",
    cadence: "custom deployment",
    description:
      "For agencies and high-volume outbound orgs that need policy, capacity, and dedicated support.",
    cta: "Contact sales",
    href: "/contact",
    highlight: false,
    features: [
      "Everything in Revenue Team",
      "Org send policy & capacity controls",
      "SSO / advanced governance",
      "Custom knowledge libraries",
      "Integration roadmap & SLAs",
      "Dedicated CSM",
    ],
  },
];

export default function PricingPage() {
  return (
    <>
      <Section className="pt-24 pb-12">
        <SectionHeading
          align="center"
          eyebrow="Pricing"
          title="Early access, priced for outcomes."
          description="Nova is opening in waves. Join the waitlist and we’ll match you to the right plan based on team size and outbound volume."
        />
      </Section>

      <Section className="py-12">
        <div className="grid gap-6 md:grid-cols-3">
          {TIERS.map((tier) => (
            <div
              key={tier.name}
              className={cn(
                "relative flex flex-col overflow-hidden rounded-2xl border bg-card/60 p-7 backdrop-blur-sm",
                tier.highlight
                  ? "border-primary/50 shadow-2xl shadow-primary/15"
                  : "border-border/60",
              )}
            >
              {tier.highlight && (
                <div
                  aria-hidden
                  className="absolute inset-0 -z-10 bg-gradient-to-b from-primary/[0.08] to-transparent"
                />
              )}

              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold">{tier.name}</h3>
                {tier.highlight && (
                  <span className="rounded-full bg-primary/15 px-2.5 py-0.5 text-[11px] font-medium text-primary">
                    Recommended
                  </span>
                )}
              </div>

              <div className="mt-4 flex items-baseline gap-1">
                <span className="text-4xl font-semibold tracking-tight tabular-nums">
                  {tier.price}
                </span>
                <span className="text-sm text-muted-foreground">
                  · {tier.cadence}
                </span>
              </div>
              <p className="mt-3 text-sm text-muted-foreground">
                {tier.description}
              </p>

              <Button
                size="lg"
                variant={tier.highlight ? "default" : "outline"}
                className="mt-6 w-full"
                nativeButton={false}
                render={<Link href={tier.href} />}
              >
                {tier.cta}
                <ArrowRight />
              </Button>

              <ul className="mt-7 space-y-3 border-t border-border/60 pt-6">
                {tier.features.map((feature) => (
                  <li key={feature} className="flex items-start gap-2.5 text-sm">
                    <span
                      className={cn(
                        "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full",
                        tier.highlight
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted text-muted-foreground",
                      )}
                    >
                      <Check className="h-3 w-3" strokeWidth={3} />
                    </span>
                    <span className="text-foreground/85">{feature}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div
          id="waitlist"
          className="mx-auto mt-14 max-w-xl rounded-2xl border border-border/60 bg-card/60 p-6 text-center"
        >
          <h3 className="text-lg font-semibold">Join the Nova waitlist</h3>
          <p className="mt-2 text-sm text-muted-foreground">
            Share your work email and we&apos;ll follow up from sales@stellixsoft.com.
          </p>
          <div className="mt-5">
            <WaitlistForm showCompany />
          </div>
        </div>
      </Section>

      <CtaBand />
    </>
  );
}
