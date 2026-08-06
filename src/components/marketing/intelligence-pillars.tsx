import {
  BookOpen,
  Bot,
  Eye,
  Layers3,
  Radar,
  Reply,
  Shuffle,
  WandSparkles,
} from "lucide-react";
import { Section, SectionHeading } from "./section";

const PILLARS = [
  {
    icon: WandSparkles,
    title: "Individually managed journeys",
    desc: "Every prospect gets a journey shaped by role, company, signals, engagement, and campaign goals — not one generic sequence for everyone.",
  },
  {
    icon: Shuffle,
    title: "Adaptive sequences",
    desc: "Generate personalized openers and follow-ups, pause on reply, wait through OOO, stop on opt-out, and continue the same thread when the conversation resumes.",
  },
  {
    icon: Reply,
    title: "Reply understanding",
    desc: "Classify intent — interest, objection, pricing, referral, delay, meeting-ready — then score potential and prepare a context-aware draft.",
  },
  {
    icon: BookOpen,
    title: "RAG business knowledge",
    desc: "Ground outreach in your real services, ICP, case studies, pricing guidance, and approved messaging so answers stay accurate and on-brand.",
  },
  {
    icon: Eye,
    title: "Engagement intelligence",
    desc: "Opens, clicks, and sequence-level activity feed prioritization — who to nudge, who to pause, and which message created momentum.",
  },
  {
    icon: Radar,
    title: "Intent & fit signals",
    desc: "Capture buying signals with Intent Radar, qualify opportunities with Fit Check, and only invest in prospects that match your knowledge.",
  },
  {
    icon: Layers3,
    title: "Connected content engine",
    desc: "The same intelligence layer powers emails, LinkedIn outreach, reply drafts, campaign messaging, and thought-leadership content.",
  },
  {
    icon: Bot,
    title: "Automation with judgment",
    desc: "Nova does not only fire rules. It understands the situation, detects problems, adapts communication, and manages toward the right outcome.",
  },
];

export function IntelligencePillars() {
  return (
    <Section className="border-t border-border/40">
      <SectionHeading
        eyebrow="Capabilities"
        title="Intelligence that actually executes revenue work."
        description="Not another contact database with AI bolted on. Nova combines research, personalization, sequencing, reply handling, and knowledge into one connected system."
      />

      <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {PILLARS.map((p) => (
          <div
            key={p.title}
            className="group rounded-2xl border border-border/60 bg-card/50 p-5 transition-colors hover:border-border hover:bg-card/80"
          >
            <span className="flex h-10 w-10 items-center justify-center rounded-xl border border-border/60 bg-background/60 text-primary transition-colors group-hover:border-primary/30 group-hover:bg-primary/10">
              <p.icon className="h-5 w-5" />
            </span>
            <h3 className="mt-4 text-sm font-semibold">{p.title}</h3>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              {p.desc}
            </p>
          </div>
        ))}
      </div>
    </Section>
  );
}
