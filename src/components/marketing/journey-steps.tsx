import {
  Brain,
  MessageSquareText,
  Route,
  ScanSearch,
  Sparkles,
} from "lucide-react";
import { Section, SectionHeading } from "./section";

const STEPS = [
  {
    icon: ScanSearch,
    title: "Understand the prospect",
    body: "Nova studies company, role, industry, signals, and campaign intent — then builds a journey for that person, not a generic blast list.",
  },
  {
    icon: Sparkles,
    title: "Personalize every message",
    body: "Outreach is grounded in your services, ICP, case studies, and approved messaging so every email sounds researched and on-brand.",
  },
  {
    icon: Route,
    title: "Manage the sequence intelligently",
    body: "Follow-ups adapt to opens, clicks, and timing. Outreach pauses on reply, waits through OOO, and stops on opt-out or hard no.",
  },
  {
    icon: MessageSquareText,
    title: "Interpret every reply",
    body: "Interest, objection, referral, delay, meeting request — Nova classifies intent, scores potential, and prepares the next-best action.",
  },
  {
    icon: Brain,
    title: "Advance to the outcome",
    body: "Drafts are ready to approve, meetings get booked, nurture continues when needed, and dead ends close cleanly — without babysitting the inbox.",
  },
];

export function JourneySteps() {
  return (
    <Section className="border-t border-border/40">
      <SectionHeading
        eyebrow="How Nova works"
        title="From first contact to final outcome — without constant decisions."
        description="Your team should not spend the day asking what to send, when to follow up, or what a reply means. Nova handles that intelligence continuously."
      />

      <div className="mt-12 grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        {STEPS.map((step, i) => (
          <div
            key={step.title}
            className="relative overflow-hidden rounded-2xl border border-border/60 bg-card/50 p-5 backdrop-blur-sm"
          >
            <div className="flex items-center justify-between gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/15 text-primary">
                <step.icon className="h-5 w-5" />
              </span>
              <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
                0{i + 1}
              </span>
            </div>
            <h3 className="mt-4 text-sm font-semibold leading-snug">
              {step.title}
            </h3>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              {step.body}
            </p>
          </div>
        ))}
      </div>
    </Section>
  );
}
