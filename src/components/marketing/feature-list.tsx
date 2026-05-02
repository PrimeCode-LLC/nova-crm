import {
  AlertTriangle,
  ClipboardCheck,
  Clock4,
  Filter,
  GitBranch,
  Kanban,
  KeyRound,
  LineChart,
  PlugZap,
  Search,
  ShieldCheck,
  Table2,
} from "lucide-react";
import { Section, SectionHeading } from "./section";

const FEATURES = [
  {
    icon: Table2,
    title: "Spreadsheet-fast table view",
    desc: "Inline editing, frozen columns, saved views, and bulk paste from Sheets. The daily driver for your team.",
  },
  {
    icon: Kanban,
    title: "Drag-and-drop pipeline",
    desc: "Move leads between stages on a Kanban board. Required-field rules enforced on drop.",
  },
  {
    icon: GitBranch,
    title: "Per-channel touchpoints",
    desc: "One lead can be at Email Step 3 and LinkedIn Connection Sent simultaneously. Touchpoints reflect reality.",
  },
  {
    icon: AlertTriangle,
    title: "Idle-lead alerts",
    desc: "Leads going stale get flagged before they die. Per-stage thresholds you control.",
  },
  {
    icon: Clock4,
    title: "First response tracking",
    desc: "Time from lead created to first outbound, a top performance metric, surfaced everywhere.",
  },
  {
    icon: KeyRound,
    title: "Org-aware access & overrides",
    desc: "Role defaults, department rules, and per-person exceptions stack in order. Reps stay on their own leads; team leads and managers get the span they need without a flat org-wide sheet.",
  },
  {
    icon: LineChart,
    title: "Director dashboard",
    desc: "Funnel charts, person scorecards, channel comparisons. Diagnose where the funnel leaks in 10 seconds.",
  },
  {
    icon: PlugZap,
    title: "n8n & webhook ready",
    desc: "Outbound queue endpoints keep your existing automations running. Instantly, Apollo, Outlook all stay.",
  },
  {
    icon: Search,
    title: "BANT-scored qualification",
    desc: "Required scoring before a lead is marked Qualified. Junior reps can't skip the rubric.",
  },
  {
    icon: Filter,
    title: "Multi-profile tracking",
    desc: "Upwork profiles and CV personas as first-class entities. See which one converts best.",
  },
  {
    icon: ClipboardCheck,
    title: "Audit log",
    desc: "Who touched what, when. Full history preserved, even after people leave the company.",
  },
  {
    icon: ShieldCheck,
    title: "Sheets, exported on demand",
    desc: "Need ad-hoc analysis? Export any view to Google Sheets in one click. The CRM stays the source of truth.",
  },
];

export function FeatureList() {
  return (
    <Section>
      <SectionHeading
        eyebrow="What's in v1"
        title="Everything you need to run sales day one."
        description="Not a half-built prototype. A working CRM with org-aware permissions, private pipelines, dashboards, and integrations on launch."
      />

      <div className="mt-12 grid gap-x-6 gap-y-8 sm:grid-cols-2 lg:grid-cols-3 lg:gap-x-8">
        {FEATURES.map((f) => (
          <div key={f.title} className="flex gap-4">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-border/60 bg-card/60 text-primary">
              <f.icon className="h-5 w-5" />
            </span>
            <div>
              <h3 className="font-medium">{f.title}</h3>
              <p className="mt-1 text-sm text-muted-foreground">{f.desc}</p>
            </div>
          </div>
        ))}
      </div>
    </Section>
  );
}
