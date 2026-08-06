import {
  Ban,
  CalendarCheck,
  Check,
  MailOpen,
  MessageSquareReply,
  PauseCircle,
  Pencil,
  Sparkles,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/**
 * Small, single-claim UI vignettes for the marketing feature rows.
 *
 * Same rationale as ProductShot: reuse the app's Card and colour tokens so the
 * language matches the product, but keep these free of app data hooks. Unlike
 * ProductShot these reflow normally, so they stay legible on narrow screens.
 */

function Chip({
  children,
  tone = "muted",
}: {
  children: React.ReactNode;
  tone?: "muted" | "warn" | "success" | "info" | "primary";
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium",
        tone === "muted" && "border-border/60 bg-muted/40 text-muted-foreground",
        tone === "warn" && "border-warning/30 bg-warning/10 text-warning",
        tone === "success" && "border-success/30 bg-success/10 text-success",
        tone === "info" && "border-chart-1/30 bg-chart-1/10 text-chart-1",
        tone === "primary" && "border-primary/30 bg-primary/10 text-primary",
      )}
    >
      {children}
    </span>
  );
}

function VignetteFrame({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className="relative">
      {/* Lifts the card off a flat background without a hard drop shadow */}
      <div
        aria-hidden
        className="absolute -inset-x-6 -inset-y-4 -z-10 rounded-[2rem] bg-[radial-gradient(ellipse_70%_60%_at_50%_40%,oklch(0.5_0.2_268/0.12),transparent_75%)] blur-xl"
      />
      <Card className={cn("gap-0 py-0 backdrop-blur-sm", className)}>
        {children}
      </Card>
    </div>
  );
}

function VignetteHeader({
  title,
  right,
}: {
  title: React.ReactNode;
  right?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-border/50 px-4 py-3">
      <p className="min-w-0 truncate text-xs font-medium text-muted-foreground">
        {title}
      </p>
      {right}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 1. Adaptive journeys                                               */
/* ------------------------------------------------------------------ */

const STEPS = [
  {
    icon: Check,
    label: "Email 1 · Introduction",
    meta: "Sent Mon 09:12 · Opened",
    state: "done" as const,
  },
  {
    icon: MailOpen,
    label: "Email 2 · Value proposition",
    meta: "Sent Wed 09:04 · Opened 3×",
    state: "done" as const,
  },
  {
    icon: PauseCircle,
    label: "Reply detected · interested",
    meta: "Sequence paused automatically",
    state: "active" as const,
  },
  {
    icon: Ban,
    label: "Email 3 · Reminder and resource",
    meta: "Skipped — no longer needed",
    state: "skipped" as const,
  },
  {
    icon: CalendarCheck,
    label: "Meeting · Thu 14:00",
    meta: "Booked from the reply",
    state: "success" as const,
  },
];

export function JourneyVignette() {
  return (
    <VignetteFrame>
      <VignetteHeader
        title="Sequence · Emily Hartley · Northwind Health"
        right={<Chip tone="primary">Paused on reply</Chip>}
      />
      <div className="px-4 py-4">
        <ol className="relative space-y-3.5">
          {/* Connector sits behind the markers to read as one thread */}
          <span
            aria-hidden
            className="absolute left-[13px] top-2 -z-0 h-[calc(100%-1.75rem)] w-px bg-border/70"
          />
          {STEPS.map((step) => (
            <li key={step.label} className="relative flex gap-3">
              <span
                className={cn(
                  "z-10 mt-0.5 flex h-[27px] w-[27px] shrink-0 items-center justify-center rounded-full border",
                  step.state === "done" &&
                    "border-border/60 bg-card text-muted-foreground",
                  step.state === "active" &&
                    "border-primary/40 bg-primary/15 text-primary",
                  step.state === "skipped" &&
                    "border-border/50 bg-card text-muted-foreground/50",
                  step.state === "success" &&
                    "border-success/40 bg-success/12 text-success",
                )}
              >
                <step.icon className="h-3.5 w-3.5" />
              </span>
              <div className="min-w-0 flex-1">
                <p
                  className={cn(
                    "text-sm leading-snug",
                    step.state === "skipped"
                      ? "text-muted-foreground/60 line-through"
                      : "text-foreground",
                  )}
                >
                  {step.label}
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {step.meta}
                </p>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </VignetteFrame>
  );
}

/* ------------------------------------------------------------------ */
/* 2. Reply intelligence                                              */
/* ------------------------------------------------------------------ */

export function ReplyVignette() {
  return (
    <VignetteFrame>
      <VignetteHeader
        title="Inbox · 1 reply needs review"
        right={<Chip tone="info">Score 0.86</Chip>}
      />

      <div className="border-b border-border/50 px-4 py-4">
        <div className="flex items-center gap-2.5">
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-chart-1/20 text-[11px] font-medium text-chart-1">
            EH
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">Emily Hartley</p>
            <p className="truncate text-xs text-muted-foreground">
              Ops Director · Northwind Health
            </p>
          </div>
          <span className="shrink-0 text-xs text-muted-foreground">9:41 AM</span>
        </div>
        <p className="mt-3 border-l-2 border-border/70 pl-3 text-sm leading-relaxed text-muted-foreground">
          “This looks useful, but we&apos;re locked into our current vendor until
          Q1. Send something over and I&apos;ll revisit then.”
        </p>
      </div>

      <div className="space-y-3 px-4 py-4">
        <div className="flex flex-wrap gap-1.5">
          <Chip tone="warn">
            <MessageSquareReply className="h-3 w-3" />
            Objection · timing
          </Chip>
          <Chip tone="success">Sentiment · warm</Chip>
          <Chip>Not a rejection</Chip>
        </div>

        <div className="rounded-lg border border-primary/25 bg-primary/[0.06] px-3 py-2.5">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-primary/90">
            Next best action
          </p>
          <p className="mt-1 text-sm">
            Nurture, then diarise 4 Jan — send the Northwind case study now
          </p>
        </div>

        <div className="rounded-lg border border-border/60 bg-muted/25 px-3 py-2.5">
          <div className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
            <Sparkles className="h-3 w-3 text-primary" />
            Draft ready
          </div>
          <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
            “Completely understand — mid-contract is the wrong time to switch.
            I&apos;ll follow up in the new year. In the meantime, here&apos;s how
            a similar ops team…”
          </p>
        </div>

        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-md bg-primary px-2.5 py-1.5 text-xs font-medium text-primary-foreground">
            <Check className="h-3.5 w-3.5" />
            Approve &amp; send
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-md border border-border/60 px-2.5 py-1.5 text-xs font-medium text-muted-foreground">
            <Pencil className="h-3.5 w-3.5" />
            Edit
          </span>
        </div>
      </div>
    </VignetteFrame>
  );
}

/* ------------------------------------------------------------------ */
/* 3. Grounded in your business                                       */
/* ------------------------------------------------------------------ */

const SOURCES = [
  { n: 1, label: "Services · Managed RevOps" },
  { n: 2, label: "Case study · Northwind Health" },
  { n: 3, label: "ICP · Ops leaders, 50–500 seats" },
];

function Cite({ n }: { n: number }) {
  return (
    <sup className="ml-0.5 inline-flex h-3.5 w-3.5 items-center justify-center rounded bg-primary/20 align-super text-[9px] font-semibold text-primary">
      {n}
    </sup>
  );
}

export function GroundingVignette() {
  return (
    <VignetteFrame>
      <VignetteHeader
        title="Draft · grounded in your knowledge base"
        right={<Chip tone="primary">3 sources</Chip>}
      />

      <div className="px-4 py-4">
        <p className="text-sm leading-relaxed">
          Hi Emily — you mentioned reporting takes three days a month. We run{" "}
          <span className="rounded bg-primary/10 px-1 underline decoration-primary/40 decoration-1 underline-offset-2">
            managed RevOps for ops leaders at 50–500 seat companies
          </span>
          <Cite n={1} /> and cut that to{" "}
          <span className="rounded bg-primary/10 px-1 underline decoration-primary/40 decoration-1 underline-offset-2">
            under four hours for a health network your size
          </span>
          <Cite n={2} />. Worth a short call?
        </p>

        <div className="mt-4 space-y-1.5 border-t border-border/50 pt-3.5">
          {SOURCES.map((s) => (
            <div key={s.n} className="flex items-center gap-2">
              <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded bg-primary/20 text-[9px] font-semibold text-primary">
                {s.n}
              </span>
              <span className="min-w-0 truncate text-xs text-muted-foreground">
                {s.label}
              </span>
            </div>
          ))}
        </div>

        <div className="mt-4 flex items-start gap-2 rounded-lg border border-border/60 bg-muted/25 px-3 py-2.5">
          <Ban className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <p className="text-xs leading-relaxed text-muted-foreground">
            Two claims were removed from this draft — Nova could not ground them
            in your knowledge base.
          </p>
        </div>
      </div>
    </VignetteFrame>
  );
}

export const VIGNETTES = {
  journey: JourneyVignette,
  replies: ReplyVignette,
  knowledge: GroundingVignette,
} as const;
