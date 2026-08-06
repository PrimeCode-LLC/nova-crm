import { Check, Minus } from "lucide-react";
import { Section, SectionHeading } from "./section";
import { cn } from "@/lib/utils";

type CellValue = boolean | "partial" | "manual";
type Row = {
  label: string;
  crm: CellValue;
  sequencer: CellValue;
  nova: CellValue;
};

const ROWS: Row[] = [
  {
    label: "Stores contacts & activity",
    crm: true,
    sequencer: "partial",
    nova: true,
  },
  {
    label: "Personalized multi-step journeys per prospect",
    crm: "partial",
    sequencer: "partial",
    nova: true,
  },
  {
    label: "RAG grounded in your services / ICP / case studies",
    crm: false,
    sequencer: false,
    nova: true,
  },
  {
    label: "Reply intent classification + next-best action",
    crm: false,
    sequencer: false,
    nova: true,
  },
  {
    label: "Pause / wait / stop sequences intelligently",
    crm: "manual",
    sequencer: "partial",
    nova: true,
  },
  {
    label: "OOO return-date wait & resume",
    crm: false,
    sequencer: false,
    nova: true,
  },
  {
    label: "Referral detection & journey reroute",
    crm: "manual",
    sequencer: false,
    nova: true,
  },
  {
    label: "Approve-ready reply drafts from full context",
    crm: "partial",
    sequencer: false,
    nova: true,
  },
  {
    label: "Engagement signals feeding prioritization",
    crm: "partial",
    sequencer: true,
    nova: true,
  },
  {
    label: "Intent capture + opportunity fit against knowledge",
    crm: false,
    sequencer: false,
    nova: true,
  },
];

export function Comparison() {
  return (
    <Section className="border-t border-border/40">
      <SectionHeading
        eyebrow="Compared"
        title="Built to run the journey — not just record it."
        description="CRMs archive history. Sequencers fire cadences. Nova understands each prospect, adapts the journey, and advances the conversation with your business knowledge."
      />

      <div className="mt-12 overflow-x-auto rounded-2xl border border-border/60 bg-card/40 backdrop-blur">
        <div className="min-w-[640px]">
          <div className="grid grid-cols-[1.5fr_1fr_1fr_1fr] divide-x divide-border/60 border-b border-border/60 bg-muted/40 text-xs font-medium uppercase tracking-wider text-muted-foreground">
            <div className="px-5 py-3.5">Capability</div>
            <div className="px-5 py-3.5 text-center">Traditional CRM</div>
            <div className="px-5 py-3.5 text-center">Email sequencer</div>
            <div className="px-5 py-3.5 text-center text-primary">Nova</div>
          </div>
          {ROWS.map((row, i) => (
            <div
              key={row.label}
              className={cn(
                "grid grid-cols-[1.5fr_1fr_1fr_1fr] divide-x divide-border/60",
                i !== ROWS.length - 1 && "border-b border-border/60",
              )}
            >
              <div className="px-5 py-4 text-sm">{row.label}</div>
              <Cell value={row.crm} />
              <Cell value={row.sequencer} />
              <Cell value={row.nova} highlight />
            </div>
          ))}
        </div>
      </div>
    </Section>
  );
}

function Cell({
  value,
  highlight,
}: {
  value: CellValue;
  highlight?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex items-center justify-center px-5 py-4",
        highlight && "bg-primary/[0.04]",
      )}
    >
      {value === true ? (
        <span
          className={cn(
            "flex h-6 w-6 items-center justify-center rounded-full",
            highlight
              ? "bg-primary text-primary-foreground"
              : "bg-emerald-500/15 text-emerald-400",
          )}
        >
          <Check className="h-3.5 w-3.5" strokeWidth={3} />
        </span>
      ) : value === false ? (
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-muted text-muted-foreground/60">
          <Minus className="h-3.5 w-3.5" />
        </span>
      ) : (
        <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-400">
          {value === "partial" ? "Partial" : "Manual"}
        </span>
      )}
    </div>
  );
}
