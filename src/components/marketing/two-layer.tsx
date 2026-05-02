import { Activity, Layers, Target } from "lucide-react";
import { Section, SectionHeading } from "./section";

const DIAGNOSTICS = [
  {
    cause: "Fewer applies",
    fix: "Work-rate problem · push harder, hire more",
  },
  {
    cause: "Same applies, fewer views",
    fix: "Profile problem · rewrite the profile",
  },
  {
    cause: "Same views, fewer replies",
    fix: "Proposal problem · better cover letters",
  },
  {
    cause: "Same replies, fewer closes",
    fix: "Sales-skill problem · follow-up & pricing",
  },
];

export function TwoLayer() {
  return (
    <Section className="border-t border-border/40">
      <div className="grid gap-12 lg:grid-cols-[1fr_1.1fr] lg:gap-16">
        <div>
          <SectionHeading
            eyebrow="Two-layer model"
            title={
              <>
                Track <span className="text-primary">effort</span> and{" "}
                <span className="text-primary">intent</span> as separate things.
              </>
            }
            description="Most CRMs only show you leads. Nova tracks the effort that creates them too. When numbers move, you can tell why, instead of guessing."
          />

          <div className="mt-8 space-y-4">
            <div className="flex items-start gap-3 rounded-xl border border-border/60 bg-card/60 p-4">
              <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary">
                <Activity className="h-4.5 w-4.5" />
              </span>
              <div>
                <h3 className="font-medium">Activity layer</h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  Daily counts per person per channel. How many emails sent. How
                  many connections. How many Upwork applies.
                </p>
              </div>
            </div>

            <div className="flex items-start gap-3 rounded-xl border border-border/60 bg-card/60 p-4">
              <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary">
                <Target className="h-4.5 w-4.5" />
              </span>
              <div>
                <h3 className="font-medium">Lead & deal layer</h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  Real records with full context, owner, stage, notes,
                  followups, BANT scoring, and per-channel touchpoint state.
                </p>
              </div>
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-border/60 bg-card/60 p-6 sm:p-7">
          <div className="flex items-center gap-2">
            <Layers className="h-4 w-4 text-primary" />
            <h3 className="font-semibold">When closings drop, find the leak.</h3>
          </div>
          <p className="mt-1.5 text-sm text-muted-foreground">
            Each diagnostic points to a totally different fix.
          </p>

          <div className="mt-6 space-y-2.5">
            {DIAGNOSTICS.map((d, i) => (
              <div
                key={d.cause}
                className="grid grid-cols-[auto_1fr] items-start gap-3 rounded-lg border border-border/40 bg-background/40 p-3"
              >
                <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-muted font-mono text-[11px] tabular-nums text-muted-foreground">
                  {i + 1}
                </span>
                <div>
                  <p className="text-sm font-medium text-foreground">
                    {d.cause}
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{d.fix}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </Section>
  );
}
