import Link from "next/link";
import { ArrowRight, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DashboardPreview } from "./dashboard-preview";
import { WaitlistForm } from "./waitlist-form";

export function Hero() {
  return (
    <section className="relative overflow-hidden pt-14 pb-16 sm:pt-20 sm:pb-24">
      <div className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-4xl text-center">
          <p className="nova-rise text-[0.7rem] font-semibold uppercase tracking-[0.28em] text-primary/90 sm:text-xs">
            Nova
          </p>

          <div className="nova-rise nova-rise-delay-1 mt-5 inline-flex items-center gap-2 rounded-full border border-border/60 bg-card/50 px-3 py-1 text-xs font-medium text-muted-foreground backdrop-blur">
            <Sparkles className="h-3 w-3 text-primary" />
            AI revenue execution · not another CRM
          </div>

          <h1 className="nova-rise nova-rise-delay-2 mt-6 text-4xl font-semibold tracking-tight text-balance sm:text-5xl md:text-6xl lg:text-[4.15rem] lg:leading-[1.05]">
            Every prospect journey,
            <br />
            <span className="bg-gradient-to-r from-foreground via-primary to-cyan-300 bg-clip-text text-transparent">
              intelligently managed.
            </span>
          </h1>

          <p className="nova-rise nova-rise-delay-3 mx-auto mt-6 max-w-2xl text-base text-muted-foreground text-pretty sm:text-lg">
            Nova uses your business knowledge, prospect context, engagement
            signals, and conversation history to personalize outreach, manage
            follow-ups, understand replies, prepare the next move, and automate
            most of the journey from first contact to final outcome.
          </p>

          <div className="nova-rise nova-rise-delay-4 mx-auto mt-9 max-w-xl">
            <WaitlistForm showCompany />
            <p className="mt-3 text-xs text-muted-foreground">
              Early access for revenue teams. Interest goes to{" "}
              <a
                href="mailto:sales@stellixsoft.com"
                className="underline underline-offset-2 hover:text-foreground"
              >
                sales@stellixsoft.com
              </a>
              .
            </p>
          </div>

          <div className="nova-rise nova-rise-delay-4 mt-6 flex flex-wrap items-center justify-center gap-3">
            <Button
              size="sm"
              variant="ghost"
              nativeButton={false}
              render={<Link href="/features" />}
            >
              See how Nova works
              <ArrowRight />
            </Button>
          </div>
        </div>

        <div className="nova-rise nova-rise-delay-4 relative mx-auto mt-14 max-w-6xl sm:mt-16">
          <div
            aria-hidden
            className="nova-soft-glow absolute -inset-x-10 -top-6 -bottom-6 -z-10 rounded-[2rem] bg-gradient-to-b from-primary/12 via-cyan-500/5 to-transparent blur-2xl"
          />
          <DashboardPreview />
        </div>
      </div>
    </section>
  );
}
