import { Check, Minus } from "lucide-react";
import { Section, SectionHeading } from "./section";
import { cn } from "@/lib/utils";

type CellValue = boolean | "partial" | "manual";
type Row = {
  label: string;
  sheets: CellValue;
  generic: CellValue;
  nova: CellValue;
};

const ROWS: Row[] = [
  {
    label: "Multi-channel funnels in one place",
    sheets: false,
    generic: "partial",
    nova: true,
  },
  {
    label: "Per-channel touchpoint state",
    sheets: false,
    generic: false,
    nova: true,
  },
  {
    label: "Activity layer (effort tracking)",
    sheets: "manual",
    generic: false,
    nova: true,
  },
  {
    label: "Idle-lead alerts",
    sheets: false,
    generic: "partial",
    nova: true,
  },
  {
    label: "BANT scoring required at stage gate",
    sheets: false,
    generic: false,
    nova: true,
  },
  {
    label: "Department + person permission overrides",
    sheets: false,
    generic: "partial",
    nova: true,
  },
  {
    label: "Private-by-default lead ownership (no silent peer browsing)",
    sheets: false,
    generic: "partial",
    nova: true,
  },
  {
    label: "Policies aligned to departments & teams (not one global role)",
    sheets: false,
    generic: "partial",
    nova: true,
  },
  {
    label: "Multi-profile (Upwork / CV) personas",
    sheets: "manual",
    generic: false,
    nova: true,
  },
  {
    label: "Replaces Sheets for daily work",
    sheets: false,
    generic: true,
    nova: true,
  },
];

export function Comparison() {
  return (
    <Section className="border-t border-border/40">
      <SectionHeading
        eyebrow="Compared"
        title="Built for the way you actually sell."
        description="Generic CRMs assume one channel and one funnel. Spreadsheets break with permissions and idle leads. Nova was designed for teams running everything at once."
      />

      <div className="mt-12 overflow-hidden rounded-2xl border border-border/60 bg-card/40 backdrop-blur">
        <div className="grid grid-cols-[1.4fr_1fr_1fr_1fr] divide-x divide-border/60 border-b border-border/60 bg-muted/40 text-xs font-medium uppercase tracking-wider text-muted-foreground">
          <div className="px-5 py-3.5">Capability</div>
          <div className="px-5 py-3.5 text-center">Google Sheets</div>
          <div className="px-5 py-3.5 text-center">Generic CRM</div>
          <div className="px-5 py-3.5 text-center text-primary">Nova CRM</div>
        </div>
        {ROWS.map((row, i) => (
          <div
            key={row.label}
            className={cn(
              "grid grid-cols-[1.4fr_1fr_1fr_1fr] divide-x divide-border/60",
              i !== ROWS.length - 1 && "border-b border-border/60"
            )}
          >
            <div className="px-5 py-4 text-sm">{row.label}</div>
            <Cell value={row.sheets} />
            <Cell value={row.generic} />
            <Cell value={row.nova} highlight />
          </div>
        ))}
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
        highlight && "bg-primary/[0.04]"
      )}
    >
      {value === true ? (
        <span
          className={cn(
            "flex h-6 w-6 items-center justify-center rounded-full",
            highlight ? "bg-primary text-primary-foreground" : "bg-emerald-500/15 text-emerald-400"
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
          {value === "partial" ? "Partial" : "Manual only"}
        </span>
      )}
    </div>
  );
}
