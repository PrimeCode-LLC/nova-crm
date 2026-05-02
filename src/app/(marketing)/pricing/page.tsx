import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CtaBand } from "@/components/marketing/cta-band";
import { Section, SectionHeading } from "@/components/marketing/section";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Pricing",
  description:
    "Simple, per-seat pricing. Start free, upgrade when your team needs department-scoped visibility, admin policy overrides, and integrations.",
};

const TIERS = [
  {
    name: "Starter",
    price: "$0",
    cadence: "free forever",
    description:
      "For solo operators and one-team workshops. The core CRM, no time limit.",
    cta: "Start free",
    href: "/signup",
    highlight: false,
    features: [
      "Up to 3 users",
      "Up to 1,000 leads",
      "All channels (email, LinkedIn, Upwork, forms)",
      "Table + Kanban + lead detail views",
      "Activity layer & idle-lead alerts",
      "Sheets import + export",
      "Community support",
    ],
  },
  {
    name: "Team",
    price: "$24",
    cadence: "per user / month",
    description:
      "For growing teams that need permissions, audit trails, and integrations.",
    cta: "Start 14-day trial",
    href: "/signup",
    highlight: true,
    features: [
      "Unlimited leads & contacts",
      "3-layer permissions: role defaults, department rules, per-person overrides",
      "Director dashboard & funnel diagnostics",
      "Followups, reminders, audit log",
      "n8n + webhook outbound queue",
      "BANT-required stage gating",
      "Priority email support",
    ],
  },
  {
    name: "Scale",
    price: "Custom",
    cadence: "talk to us",
    description:
      "For agencies and 25+ seat sales orgs running multi-profile outbound at scale.",
    cta: "Contact sales",
    href: "/contact",
    highlight: false,
    features: [
      "Everything in Team",
      "SSO / SAML",
      "Custom integrations (Apollo, Outlook, LinkedIn)",
      "Commission engine (v2 early access)",
      "Cohort & ROI analytics",
      "Dedicated migration engineer",
      "SLAs and dedicated CSM",
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
          title="One price, everything included."
          description="No hidden modules, no per-channel charges, no per-pipeline fees. Pay for seats, get the whole product."
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
                  : "border-border/60"
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
                    Most popular
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
                          : "bg-muted text-muted-foreground"
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

        <p className="mt-10 text-center text-xs text-muted-foreground">
          All plans include unlimited channels, all view types, and migration
          from Sheets. Annual billing saves 20%.
        </p>
      </Section>

      <CtaBand />
    </>
  );
}
