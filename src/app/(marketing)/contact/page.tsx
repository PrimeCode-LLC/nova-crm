import type { Metadata } from "next";
import { Mail, MessageSquare, Phone } from "lucide-react";
import { Section, SectionHeading } from "@/components/marketing/section";
import { ContactForm } from "@/components/marketing/contact-form";

export const metadata: Metadata = {
  title: "Contact",
  description:
    "Talk to the team: sales questions, migration help, feature requests, or just a hello.",
};

const CHANNELS = [
  {
    icon: Mail,
    title: "Email",
    body: "hello@novacrm.com",
    note: "Replies within 24 hours, Mon–Fri.",
  },
  {
    icon: MessageSquare,
    title: "Live chat",
    body: "Sign up to start a thread in-app.",
    note: "Fastest path for trial questions.",
  },
  {
    icon: Phone,
    title: "Sales",
    body: "For 25+ seat orgs.",
    note: "Use the form and we'll book a call.",
  },
];

export default function ContactPage() {
  return (
    <Section className="pt-24 pb-24">
      <SectionHeading
        align="center"
        eyebrow="Contact"
        title="Let's talk."
        description="Migration questions, integration timelines, or just a sanity check. We read everything."
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
                <p className="mt-0.5 text-sm text-foreground/85">{c.body}</p>
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
