import type { ComponentType } from "react";
import {
  Brain,
  CalendarClock,
  MailOpen,
  MessageSquareReply,
  PauseCircle,
  Sparkles,
  Target,
} from "lucide-react";
import { cn } from "@/lib/utils";

const REPLY_ACTIONS = [
  {
    name: "Sarah Chen · Acme Health",
    classLabel: "Ready to meet",
    score: 92,
    action: "Book meeting",
    accent: "text-emerald-300 bg-emerald-500/15",
  },
  {
    name: "Marcus Lee · Northline",
    classLabel: "OOO until Mar 18",
    score: 74,
    action: "Wait & resume",
    accent: "text-amber-300 bg-amber-500/15",
  },
  {
    name: "Priya Nair · Helix Ops",
    classLabel: "Pricing objection",
    score: 68,
    action: "Reply with draft",
    accent: "text-cyan-300 bg-cyan-500/15",
  },
];

const SEQUENCE = [
  { step: 1, label: "Personalized opener", status: "Sent", tone: "done" },
  { step: 2, label: "Value follow-up", status: "Opened 3×", tone: "active" },
  { step: 3, label: "Case-study nudge", status: "Paused on reply", tone: "paused" },
  { step: 4, label: "Breakup note", status: "Skipped", tone: "skip" },
];

export function DashboardPreview() {
  return (
    <div className="overflow-hidden rounded-2xl border border-border/60 bg-card/80 shadow-2xl shadow-black/40 backdrop-blur-xl">
      <div className="flex items-center gap-2 border-b border-border/60 bg-muted/40 px-4 py-3">
        <div className="flex gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-rose-400/70" />
          <span className="h-2.5 w-2.5 rounded-full bg-amber-400/70" />
          <span className="h-2.5 w-2.5 rounded-full bg-emerald-400/70" />
        </div>
        <div className="ml-3 flex h-6 flex-1 items-center justify-center rounded-md bg-background/60 px-3 font-mono text-[11px] text-muted-foreground">
          app.novacrm.com / prospect journey
        </div>
      </div>

      <div className="p-4 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-base font-semibold">Prospect intelligence</h3>
              <span className="inline-flex items-center gap-1 rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-medium text-primary">
                <Sparkles className="h-2.5 w-2.5" />
                Live
              </span>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Nova reads the conversation, decides the next move, and drafts the
              response.
            </p>
          </div>
          <div className="flex flex-wrap gap-2 text-[11px]">
            <Chip icon={MailOpen} label="Engagement tracked" />
            <Chip icon={Brain} label="RAG grounded" />
            <Chip icon={PauseCircle} label="Pause on reply" />
          </div>
        </div>

        <div className="mt-5 grid gap-4 lg:grid-cols-[1.15fr_0.85fr]">
          <div className="rounded-xl border border-border/60 bg-background/60 p-4">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <MessageSquareReply className="h-4 w-4 text-primary" />
                <h4 className="text-sm font-medium">Reply intelligence</h4>
              </div>
              <span className="text-[11px] text-muted-foreground">
                Next-best actions
              </span>
            </div>

            <div className="mt-3 space-y-2.5">
              {REPLY_ACTIONS.map((row) => (
                <div
                  key={row.name}
                  className="flex flex-col gap-2 rounded-lg border border-border/50 bg-card/40 p-3 sm:flex-row sm:items-center"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{row.name}</p>
                    <div className="mt-1 flex flex-wrap items-center gap-2">
                      <span
                        className={cn(
                          "rounded-full px-2 py-0.5 text-[10px] font-medium",
                          row.accent,
                        )}
                      >
                        {row.classLabel}
                      </span>
                      <span className="text-[11px] text-muted-foreground">
                        Potential {row.score}
                      </span>
                    </div>
                  </div>
                  <span className="shrink-0 rounded-md border border-border/60 bg-muted/40 px-2.5 py-1 text-[11px] font-medium">
                    {row.action}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="space-y-4">
            <div className="rounded-xl border border-border/60 bg-background/60 p-4">
              <div className="flex items-center gap-2">
                <Target className="h-4 w-4 text-cyan-300" />
                <h4 className="text-sm font-medium">Adaptive sequence</h4>
              </div>
              <p className="mt-1 text-[11px] text-muted-foreground">
                Built for one prospect · adjusted by engagement & replies
              </p>
              <div className="mt-3 space-y-2">
                {SEQUENCE.map((s) => (
                  <div
                    key={s.step}
                    className="flex items-center gap-3 rounded-lg border border-border/40 bg-card/30 px-3 py-2"
                  >
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-muted font-mono text-[11px] text-muted-foreground">
                      {s.step}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-medium">{s.label}</p>
                    </div>
                    <StatusPill tone={s.tone} label={s.status} />
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-xl border border-border/60 bg-background/60 p-4">
              <div className="flex items-center gap-2">
                <CalendarClock className="h-4 w-4 text-amber-300" />
                <h4 className="text-sm font-medium">Draft ready to approve</h4>
              </div>
              <p className="mt-2 rounded-lg border border-border/40 bg-card/40 p-3 text-xs leading-relaxed text-muted-foreground">
                &ldquo;Thanks for the note, Priya — happy to share how similar
                ops teams cut follow-up load. Would a 20-min walkthrough Thursday
                work, or should I send the one-pager first?&rdquo;
              </p>
              <div className="mt-3 flex gap-2">
                <span className="rounded-md bg-primary px-2.5 py-1 text-[11px] font-medium text-primary-foreground">
                  Approve & send
                </span>
                <span className="rounded-md border border-border/60 px-2.5 py-1 text-[11px] text-muted-foreground">
                  Regenerate
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Chip({
  icon: Icon,
  label,
}: {
  icon: ComponentType<{ className?: string }>;
  label: string;
}) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-border/50 bg-background/50 px-2.5 py-1 text-muted-foreground">
      <Icon className="h-3 w-3 text-primary" />
      {label}
    </span>
  );
}

function StatusPill({
  tone,
  label,
}: {
  tone: string;
  label: string;
}) {
  return (
    <span
      className={cn(
        "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium",
        tone === "done" && "bg-emerald-500/15 text-emerald-300",
        tone === "active" && "bg-primary/15 text-primary",
        tone === "paused" && "bg-amber-500/15 text-amber-300",
        tone === "skip" && "bg-muted text-muted-foreground",
      )}
    >
      {label}
    </span>
  );
}
