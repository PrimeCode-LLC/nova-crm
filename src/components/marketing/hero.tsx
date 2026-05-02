import Link from "next/link";
import { ArrowRight, BarChart3, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DashboardPreview } from "./dashboard-preview";

export function Hero() {
  return (
    <section className="relative overflow-hidden pt-16 pb-20 sm:pt-24 sm:pb-28">
      <div className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-3xl text-center">
          <div className="inline-flex items-center gap-2 rounded-full border border-border/60 bg-card/60 px-3 py-1 text-xs font-medium text-muted-foreground backdrop-blur">
            <Sparkles className="h-3 w-3 text-primary" />
            Built for teams running 6+ outbound channels
          </div>

          <h1 className="mt-6 text-4xl font-semibold tracking-tight sm:text-5xl md:text-6xl lg:text-[4rem] lg:leading-[1.05]">
            Every lead, every channel,
            <br />
            <span className="bg-gradient-to-r from-primary via-indigo-400 to-fuchsia-400 bg-clip-text text-transparent">
              one system of record.
            </span>
          </h1>

          <p className="mx-auto mt-6 max-w-2xl text-base text-muted-foreground sm:text-lg">
            Replace the Google Sheet that sits between your scrapers, Instantly,
            LinkedIn, Upwork, and inbound. Nova CRM gives you per-channel
            funnels, idle-lead alerts, and director-level diagnostics, plus
            private-by-default leads and admin policies mapped to departments
            and teams, so reps are not browsing each other&apos;s books by
            accident.
          </p>

          <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
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
              render={<Link href="/features" />}
            >
              <BarChart3 />
              See the dashboard
            </Button>
          </div>

          <p className="mt-4 text-xs text-muted-foreground">
            No credit card required · 14-day trial · Migrate from Sheets in 1
            click
          </p>
        </div>

        <div className="relative mx-auto mt-16 max-w-6xl">
          <div className="absolute -inset-x-12 -top-8 -bottom-8 -z-10 rounded-[2rem] bg-gradient-to-b from-primary/10 via-transparent to-transparent blur-2xl" />
          <DashboardPreview />
        </div>
      </div>
    </section>
  );
}
