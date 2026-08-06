import { Check, Library, ShieldCheck } from "lucide-react";
import { Section, SectionHeading } from "./section";

const SOURCES = [
  "Services & solutions",
  "Ideal customer profiles",
  "Case studies & proof",
  "Pricing & commercial models",
  "Objection-handling guidance",
  "Brand positioning",
  "Campaign objectives",
  "Approved messaging",
  "Industry knowledge",
  "Prior conversations",
];

export function KnowledgeRag() {
  return (
    <Section className="border-t border-border/40">
      <div className="grid gap-12 lg:grid-cols-[1.05fr_1fr] lg:gap-16">
        <div className="rounded-2xl border border-border/60 bg-card/60 p-6 sm:p-7">
          <div className="flex items-center gap-2">
            <Library className="h-4 w-4 text-primary" />
            <h3 className="font-semibold">Company knowledge library</h3>
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            Retrieval-augmented generation pulls only the relevant slices of your
            business knowledge into each prospect journey.
          </p>
          <div className="mt-6 grid gap-2 sm:grid-cols-2">
            {SOURCES.map((source) => (
              <div
                key={source}
                className="flex items-center gap-2 rounded-lg border border-border/40 bg-background/40 px-3 py-2 text-sm"
              >
                <Check className="h-3.5 w-3.5 shrink-0 text-primary" strokeWidth={3} />
                <span>{source}</span>
              </div>
            ))}
          </div>
        </div>

        <div>
          <SectionHeading
            eyebrow="RAG-powered"
            title="Outreach grounded in your business — not invented claims."
            description="Nova connects sequences, replies, Fit Check, and content to the same knowledge layer so every message stays accurate, relevant, and consistent."
          />

          <div className="mt-8 space-y-4">
            <div className="rounded-xl border border-border/60 bg-card/60 p-4">
              <div className="flex items-center gap-2">
                <ShieldCheck className="h-4 w-4 text-emerald-300" />
                <h3 className="font-medium">Strict, reference, or open modes</h3>
              </div>
              <p className="mt-1.5 text-sm text-muted-foreground">
                Control how tightly generation must stick to approved sources —
                ideal for services, ICP, and commercial claims.
              </p>
            </div>
            <div className="rounded-xl border border-border/60 bg-card/60 p-4">
              <h3 className="font-medium">One intelligence layer</h3>
              <p className="mt-1.5 text-sm text-muted-foreground">
                Sales outreach and marketing content stop living in disconnected
                tools. Both run from the same business understanding.
              </p>
            </div>
          </div>
        </div>
      </div>
    </Section>
  );
}
