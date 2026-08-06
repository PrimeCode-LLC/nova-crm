import {
  CalendarClock,
  CircleDollarSign,
  Handshake,
  MailWarning,
  ThumbsDown,
  UserRoundPlus,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Section, SectionHeading } from "./section";

const INTENTS = [
  {
    icon: Handshake,
    label: "Meeting interest",
    action: "Book meeting · draft confirm",
    color: "text-emerald-300 bg-emerald-500/15",
  },
  {
    icon: CircleDollarSign,
    label: "Pricing concern",
    action: "Reply with grounded commercial context",
    color: "text-cyan-300 bg-cyan-500/15",
  },
  {
    icon: CalendarClock,
    label: "Follow up later / OOO",
    action: "Wait until return date · resume sequence",
    color: "text-amber-300 bg-amber-500/15",
  },
  {
    icon: UserRoundPlus,
    label: "Referral / wrong person",
    action: "Extract new contact · reroute journey",
    color: "text-violet-300 bg-violet-500/15",
  },
  {
    icon: ThumbsDown,
    label: "Soft or hard no",
    action: "Nurture or close lost cleanly",
    color: "text-rose-300 bg-rose-500/15",
  },
  {
    icon: MailWarning,
    label: "Unsubscribe / auto-reply",
    action: "Stop outreach · avoid bad follow-ups",
    color: "text-orange-300 bg-orange-500/15",
  },
];

export function ReplyIntelligence() {
  return (
    <Section className="border-t border-border/40">
      <div className="grid gap-12 lg:grid-cols-[1fr_1.05fr] lg:gap-16">
        <div>
          <SectionHeading
            eyebrow="Reply intelligence"
            title="Every reply becomes a scored next action."
            description="Nova does not mark replies as ‘received’ and walk away. It reads the full conversation, explains what the reply means, and prepares what should happen next."
          />

          <div className="mt-8 space-y-4 text-sm leading-relaxed text-muted-foreground">
            <p>
              Interest, objections, timing preferences, referrals, pricing
              questions, OOO return dates, and opt-outs are detected as first-class
              signals — then mapped to actions your team can approve in seconds.
            </p>
            <p>
              When a draft is needed, Nova writes it from prospect history and your
              company knowledge, not a generic template.
            </p>
          </div>
        </div>

        <div className="rounded-2xl border border-border/60 bg-card/60 p-5 sm:p-6">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-sm font-semibold">Intent → next best action</h3>
            <span className="rounded-full bg-muted px-2.5 py-1 text-[10px] font-medium text-muted-foreground">
              Approve & send
            </span>
          </div>
          <div className="mt-4 grid gap-2.5 sm:grid-cols-2">
            {INTENTS.map((item) => (
              <div
                key={item.label}
                className="rounded-xl border border-border/50 bg-background/50 p-3.5"
              >
                <div className="flex items-center gap-2">
                  <span
                    className={cn(
                      "flex h-8 w-8 items-center justify-center rounded-lg",
                      item.color,
                    )}
                  >
                    <item.icon className="h-4 w-4" />
                  </span>
                  <p className="text-sm font-medium">{item.label}</p>
                </div>
                <p className="mt-2 text-xs text-muted-foreground">{item.action}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </Section>
  );
}
