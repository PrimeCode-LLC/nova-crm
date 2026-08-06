import { ArrowRight, Database, Workflow, Zap } from "lucide-react";
import { Section, SectionHeading } from "./section";

const CONTRAST = [
  {
    side: "Traditional CRM",
    icon: Database,
    points: [
      "Stores contacts and activity history",
      "Shows what happened after you dig",
      "Leaves next steps to the salesperson",
      "Sequences usually stay rigid",
      "Replies become another inbox chore",
    ],
  },
  {
    side: "Nova",
    icon: Zap,
    points: [
      "Understands each prospect in context",
      "Interprets what is happening now",
      "Decides and prepares what should happen next",
      "Sequences adapt to engagement and replies",
      "Reply intelligence drafts the next move",
    ],
    highlight: true,
  },
];

export function NotAnotherCrm() {
  return (
    <Section className="border-t border-border/40">
      <SectionHeading
        align="center"
        eyebrow="Positioning"
        title={
          <>
            Your CRM records the journey.{" "}
            <span className="text-primary">Nova runs it.</span>
          </>
        }
        description="Nova is not an all-in-one sales CRM. It is an AI revenue execution system built to think through, manage, and automate every prospect journey using your business intelligence."
      />

      <div className="mx-auto mt-12 grid max-w-5xl gap-4 md:grid-cols-[1fr_auto_1fr] md:items-stretch">
        {CONTRAST.map((col, idx) => (
          <div key={col.side} className="contents">
            <div
              className={
                col.highlight
                  ? "rounded-2xl border border-primary/40 bg-primary/[0.07] p-6 shadow-lg shadow-primary/10"
                  : "rounded-2xl border border-border/60 bg-card/50 p-6"
              }
            >
              <div className="flex items-center gap-2">
                <col.icon
                  className={
                    col.highlight ? "h-4 w-4 text-primary" : "h-4 w-4 text-muted-foreground"
                  }
                />
                <h3 className="font-semibold">{col.side}</h3>
              </div>
              <ul className="mt-5 space-y-3">
                {col.points.map((point) => (
                  <li
                    key={point}
                    className="flex gap-2 text-sm text-muted-foreground"
                  >
                    <span
                      className={
                        col.highlight
                          ? "mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-primary"
                          : "mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-muted-foreground/50"
                      }
                    />
                    <span className={col.highlight ? "text-foreground/90" : undefined}>
                      {point}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
            {idx === 0 && (
              <div className="hidden items-center justify-center md:flex">
                <span className="flex h-10 w-10 items-center justify-center rounded-full border border-border/60 bg-card text-muted-foreground">
                  <ArrowRight className="h-4 w-4" />
                </span>
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="mx-auto mt-8 flex max-w-3xl items-start gap-3 rounded-2xl border border-border/60 bg-card/40 p-5">
        <Workflow className="mt-0.5 h-5 w-5 shrink-0 text-cyan-300" />
        <p className="text-sm leading-relaxed text-muted-foreground">
          <span className="font-medium text-foreground">
            You do not manage the prospect journey. Nova does.
          </span>{" "}
          Keep your CRM as the system of record if you want — Nova is the
          intelligence layer that researches, writes, follows up, interprets,
          and advances each opportunity.
        </p>
      </div>
    </Section>
  );
}
