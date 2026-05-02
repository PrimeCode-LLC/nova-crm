import {
  Briefcase,
  FileText,
  Globe,
  Mail,
  MailPlus,
  Network,
  UserPlus,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Section, SectionHeading } from "./section";

const CHANNELS = [
  {
    icon: Mail,
    name: "Cold Email",
    desc: "Replies from Instantly campaigns become real leads, automatically.",
    funnel: "Sent → Opened → Clicked → Replied → Meeting → Closed",
    color: "from-indigo-500/20 to-indigo-500/0",
    iconBg: "bg-indigo-500/15 text-indigo-300",
  },
  {
    icon: Network,
    name: "LinkedIn Outbound",
    desc: "Sales Navigator + manual outreach with per-lead touchpoint state.",
    funnel: "Connection → Accepted → Messaged → Replied → Meeting → Closed",
    color: "from-cyan-500/20 to-cyan-500/0",
    iconBg: "bg-cyan-500/15 text-cyan-300",
  },
  {
    icon: MailPlus,
    name: "1:1 Email",
    desc: "Senior reps' personalized Outlook outreach, threaded with the lead.",
    funnel: "Sent → Replied → Meeting → Closed",
    color: "from-emerald-500/20 to-emerald-500/0",
    iconBg: "bg-emerald-500/15 text-emerald-300",
  },
  {
    icon: Globe,
    name: "Website Form",
    desc: "Webhook in. Lead created the moment a prospect hits submit.",
    funnel: "Submitted → Contacted → Meeting → Closed",
    color: "from-amber-500/20 to-amber-500/0",
    iconBg: "bg-amber-500/15 text-amber-300",
  },
  {
    icon: Briefcase,
    name: "Upwork",
    desc: "Multi-profile tracking. Compare which Upwork persona converts best.",
    funnel: "Applied → Viewed → Replied → Hired → Revenue",
    color: "from-fuchsia-500/20 to-fuchsia-500/0",
    iconBg: "bg-fuchsia-500/15 text-fuchsia-300",
  },
  {
    icon: FileText,
    name: "Job Apply",
    desc: "Multiple CVs as first-class personas, with recruiter response funnels.",
    funnel: "Applied → Recruiter Reply → Interview → Offer",
    color: "from-rose-500/20 to-rose-500/0",
    iconBg: "bg-rose-500/15 text-rose-300",
  },
  {
    icon: UserPlus,
    name: "LinkedIn 1:1",
    desc: "Account-based DMs from senior reps, separate from outbound.",
    funnel: "Messaged → Replied → Meeting → Closed",
    color: "from-violet-500/20 to-violet-500/0",
    iconBg: "bg-violet-500/15 text-violet-300",
  },
];

export function ChannelsGrid() {
  return (
    <Section>
      <SectionHeading
        eyebrow="Channels"
        title="Every funnel your team actually runs"
        description="Each channel keeps its own top-of-funnel shape. After Qualified, every lead joins one shared closing pipeline, so dashboards compare apples to apples."
      />

      <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {CHANNELS.map((ch) => (
          <div
            key={ch.name}
            className="group relative overflow-hidden rounded-2xl border border-border/60 bg-card/60 p-6 backdrop-blur-sm transition-colors hover:border-border"
          >
            <div
              aria-hidden
              className={cn(
                "absolute inset-0 -z-10 bg-gradient-to-br opacity-0 transition-opacity duration-500 group-hover:opacity-100",
                ch.color
              )}
            />
            <div
              className={cn(
                "flex h-10 w-10 items-center justify-center rounded-xl",
                ch.iconBg
              )}
            >
              <ch.icon className="h-5 w-5" />
            </div>
            <h3 className="mt-4 text-base font-semibold">{ch.name}</h3>
            <p className="mt-1.5 text-sm text-muted-foreground">{ch.desc}</p>
            <p className="mt-4 font-mono text-[11px] leading-relaxed text-muted-foreground/80">
              {ch.funnel}
            </p>
          </div>
        ))}
      </div>
    </Section>
  );
}
