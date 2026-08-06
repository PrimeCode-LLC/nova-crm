import type { Metadata } from "next";
import { Mail, MessageSquare, Users } from "lucide-react";
import { Section, SectionHeading } from "@/components/marketing/section";
import { ContactForm } from "@/components/marketing/contact-form";
import { SITE } from "@/lib/site";

export const metadata: Metadata = {
  title: "Contact",
  description:
    "Talk to Nova sales about waitlist access, demos, migrations, or partnership questions.",
};

const CHANNELS = [
  {
    icon: Mail,
    title: "Sales",
    body: SITE.salesEmail,
    note: "Waitlist, demos, and enterprise inquiries.",
  },
  {
    icon: MessageSquare,
    title: "Product questions",
    body: "Use the form with context.",
    note: "Tell us your channels, volume, and team size.",
  },
  {
    icon: Users,
    title: "Teams & agencies",
    body: "25+ seats or multi-client ops.",
    note: "We’ll book a working session, not a slideshow.",
  },
];

export default function ContactPage() {
  return (
    <Section className="pt-24 pb-24">
      <SectionHeading
        align="center"
        eyebrow="Contact"
        title="Talk to the Nova team."
        description="Waitlist access, rollout planning, or a sanity check on whether Nova fits your motion. We read everything."
      />

      <div className="mx-auto mt-16 grid max-w-5xl gap-10 lg:grid-cols-[1fr_1.2fr]">
        <div className="space-y-4">
          {CHANNELS.map((c) => (
            <div
              key={c.title}
              className="flex gap-4 rounded-2xl border border-border/60 bg-card/60 p-5 backdrop-blur-sm"
            >
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/15 text-primary">
                <c.icon className="h-5 w-5" />
              </span>
              <div>
                <h3 className="font-medium">{c.title}</h3>
                <p className="mt-0.5 text-sm text-foreground/85">
                  {c.title === "Sales" ? (
                    <a
                      href={`mailto:${SITE.salesEmail}`}
                      className="underline underline-offset-2 hover:text-foreground"
                    >
                      {c.body}
                    </a>
                  ) : (
                    c.body
                  )}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">{c.note}</p>
              </div>
            </div>
          ))}
        </div>

        <div className="rounded-2xl border border-border/60 bg-card/60 p-7 backdrop-blur-sm">
          <ContactForm />
        </div>
      </div>
    </Section>
  );
}
