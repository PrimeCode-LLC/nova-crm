import {
  Building2,
  Eye,
  EyeOff,
  Lock,
  Shield,
  UsersRound,
} from "lucide-react";
import { Section, SectionHeading } from "./section";

const PILLARS = [
  {
    icon: EyeOff,
    title: "Your book stays yours",
    body: "By default, individual contributors only see leads they own or are explicitly shared with them. Teammates cannot browse someone else's pipeline like a shared spreadsheet.",
  },
  {
    icon: Building2,
    title: "Mirrors how you actually organize",
    body: "Departments and teams map to your real org chart. Managers inherit visibility for their span. Directors roll up without granting org-wide access to everyone.",
  },
  {
    icon: Shield,
    title: "Admin policies with real overrides",
    body: "Start from role templates, then layer department rules and per-person exceptions. Overrides are first-class so edge cases (coverage, audits, VIP accounts) don't break the model.",
  },
];

const LADDER = [
  { scope: "Individual rep", sees: "Own leads & assigned tasks" },
  { scope: "Team lead", sees: "Their team's pipeline + coaching views" },
  { scope: "Department", sees: "Cross-team rollups inside the dept" },
  { scope: "Director / admin", sees: "Org-wide + policy editor + audit trail" },
];

export function TeamAccessGovernance() {
  return (
    <Section className="border-t border-border/40">
      <div className="grid gap-12 lg:grid-cols-[1fr_1.05fr] lg:gap-16">
        <div>
          <SectionHeading
            eyebrow="Permissions & privacy"
            title={
              <>
                Sell with confidence:{" "}
                <span className="text-primary">governance is not an afterthought.</span>
              </>
            }
            description="Buyers ask hard questions about data leakage and junior access before they sign. Nova CRM is built so you can answer them in one slide: private-by-default leads, org-shaped visibility, and admin policies you can explain to legal."
          />

          <div className="mt-8 space-y-4">
            {PILLARS.map((p) => (
              <div
                key={p.title}
                className="flex items-start gap-3 rounded-xl border border-border/60 bg-card/60 p-4"
              >
                <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary">
                  <p.icon className="h-4.5 w-4.5" />
                </span>
                <div>
                  <h3 className="font-medium">{p.title}</h3>
                  <p className="mt-1 text-sm text-muted-foreground">{p.body}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-2xl border border-border/60 bg-card/60 p-6 sm:p-7">
          <div className="flex items-center gap-2">
            <UsersRound className="h-4 w-4 text-primary" />
            <h3 className="font-semibold">Who sees what (out of the box)</h3>
          </div>
          <p className="mt-1.5 text-sm text-muted-foreground">
            A clear ladder from rep privacy to executive oversight. Tune each
            layer without giving everyone a master key.
          </p>

          <div className="mt-6 space-y-2.5">
            {LADDER.map((row, i) => (
              <div
                key={row.scope}
                className="grid grid-cols-[auto_1fr] items-start gap-3 rounded-lg border border-border/40 bg-background/40 p-3"
              >
                <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-muted font-mono text-[11px] tabular-nums text-muted-foreground">
                  {i + 1}
                </span>
                <div>
                  <p className="text-sm font-medium text-foreground">
                    {row.scope}
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {row.sees}
                  </p>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-6 flex items-start gap-2 rounded-lg border border-primary/20 bg-primary/[0.06] p-3 text-xs text-muted-foreground">
            <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
            <p>
              <span className="font-medium text-foreground">
                For security & procurement:
              </span>{" "}
              Combine scoped visibility with the audit log and export controls
              so your questionnaire answers line up: who can see customer data,
              how access changes are recorded, and how data leaves the system.
            </p>
          </div>

          <div className="mt-4 flex items-center gap-2 text-xs text-muted-foreground">
            <Eye className="h-3.5 w-3.5 text-muted-foreground/80" />
            <span>
              Optional shared views and handoffs stay explicit — visibility
              changes leave a trail.
            </span>
          </div>
        </div>
      </div>
    </Section>
  );
}
