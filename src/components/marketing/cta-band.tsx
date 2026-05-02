import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";

export function CtaBand() {
  return (
    <section className="relative py-20 sm:py-28">
      <div className="mx-auto w-full max-w-5xl px-4 sm:px-6 lg:px-8">
        <div className="relative overflow-hidden rounded-3xl border border-border/60 bg-card/60 px-8 py-16 text-center backdrop-blur-xl sm:px-16">
          <div
            aria-hidden
            className="absolute inset-0 -z-10 bg-[radial-gradient(60%_50%_at_50%_0%,oklch(0.7_0.17_265/.18),transparent_70%)]"
          />
          <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">
            Stop guessing where the funnel leaks.
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-muted-foreground">
            Migrate from Sheets in a single click. Be running real pipeline
            diagnostics before lunch.
          </p>
          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Button
              size="lg"
              nativeButton={false}
              render={<Link href="/signup" />}
            >
              Start free
              <ArrowRight />
            </Button>
            <Button
              size="lg"
              variant="outline"
              nativeButton={false}
              render={<Link href="/contact" />}
            >
              Talk to us
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}
