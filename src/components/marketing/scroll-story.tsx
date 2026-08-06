"use client";

import {
  useEffect,
  useRef,
  useState,
  type ComponentType,
} from "react";
import Link from "next/link";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { WaitlistForm } from "./waitlist-form";
import { setNovaSceneParams } from "./nova-scene-params";

gsap.registerPlugin(ScrollTrigger);

const CHAPTERS = [
  {
    id: "hero",
    eyebrow: "Nova",
    title: "Every prospect journey,\nintelligently managed.",
    body: "Nova uses your business knowledge, prospect context, engagement signals, and conversation history to personalize outreach, manage follow-ups, understand replies, and automate most of the path from first contact to final outcome.",
    waitlist: true,
  },
  {
    id: "not-crm",
    eyebrow: "Positioning",
    title: "Your CRM records the journey.\nNova runs it.",
    body: "Nova is not an all-in-one sales CRM. It is an AI revenue execution system that thinks through, manages, and advances every prospect using your business intelligence.",
  },
  {
    id: "journey",
    eyebrow: "Journeys",
    title: "Every prospect,\nhandled individually.",
    body: "Sequences adapt to role, company, signals, and engagement. Follow-ups pause on reply, wait through OOO, stop on opt-out, and continue the thread when the conversation resumes.",
  },
  {
    id: "replies",
    eyebrow: "Reply intelligence",
    title: "Every reply becomes\na scored next action.",
    body: "Interest, objections, referrals, delays, meeting requests — Nova classifies intent, scores potential, and prepares a context-aware draft ready to approve.",
  },
  {
    id: "knowledge",
    eyebrow: "RAG-powered",
    title: "Grounded in your business —\nnot invented claims.",
    body: "Outreach cites your real services, ICP, case studies, and approved messaging so every message stays accurate, relevant, and on-brand.",
  },
  {
    id: "close",
    eyebrow: "Early access",
    title: "You do not manage the\nprospect journey. Nova does.",
    body: "Join the waitlist. We’ll follow up from sales@stellixsoft.com.",
    waitlist: true,
  },
] as const;

function clamp01(n: number) {
  return Math.min(1, Math.max(0, n));
}

function sceneFromProgress(p: number) {
  setNovaSceneParams({
    progress: p,
    connect: clamp01((p - 0.1) / 0.28),
    focus: clamp01((p - 0.38) / 0.28),
    settle: clamp01((p - 0.72) / 0.22),
    drift: 0.42 - p * 0.28,
  });
}

function CanvasFallback({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={className}
      style={{
        background:
          "radial-gradient(ellipse 60% 50% at 50% 45%, oklch(0.45 0.1 265 / 0.2), transparent 70%)",
      }}
    />
  );
}

export function ScrollStory() {
  const rootRef = useRef<HTMLDivElement>(null);
  const [NovaCanvas, setNovaCanvas] = useState<ComponentType<{
    className?: string;
  }> | null>(null);

  // Load WebGL canvas after mount — avoids next/dynamic script-tag warnings
  // and keeps Three.js out of the SSR path entirely.
  useEffect(() => {
    let cancelled = false;
    void import("./nova-canvas").then((m) => {
      if (!cancelled) setNovaCanvas(() => m.NovaCanvas);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const chapters = gsap.utils.toArray<HTMLElement>(
      root.querySelectorAll("[data-chapter]"),
    );

    const ctx = gsap.context(() => {
      if (reduced) {
        chapters.forEach((el) => {
          gsap.set(el, { opacity: 1, y: 0 });
        });
        sceneFromProgress(0.35);
        return;
      }

      gsap.set(chapters, { opacity: 0, y: 28 });
      if (chapters[0]) gsap.set(chapters[0], { opacity: 1, y: 0 });

      ScrollTrigger.create({
        trigger: root,
        start: "top top",
        end: "bottom bottom",
        scrub: 0.65,
        onUpdate: (self) => sceneFromProgress(self.progress),
      });

      chapters.forEach((section) => {
        ScrollTrigger.create({
          trigger: section,
          start: "top 70%",
          end: "bottom 35%",
          scrub: 0.5,
          onUpdate: (self) => {
            const o =
              self.progress < 0.15
                ? self.progress / 0.15
                : self.progress > 0.85
                  ? (1 - self.progress) / 0.15
                  : 1;
            const y = (1 - o) * 18;
            gsap.set(section, { opacity: clamp01(o), y });
          },
        });
      });
    }, root);

    sceneFromProgress(0);

    return () => {
      ctx.revert();
      setNovaSceneParams({
        progress: 0,
        connect: 0,
        focus: 0,
        settle: 0,
        drift: 0.35,
      });
    };
  }, []);

  return (
    <div ref={rootRef} className="relative">
      {NovaCanvas ? (
        <NovaCanvas className="pointer-events-none fixed inset-0 -z-10 h-dvh w-full" />
      ) : (
        <CanvasFallback className="pointer-events-none fixed inset-0 -z-10 h-dvh w-full" />
      )}

      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 -z-[9] bg-[radial-gradient(ellipse_at_center,transparent_0%,oklch(0.14_0_0/0.35)_55%,oklch(0.12_0_0/0.78)_100%)]"
      />

      <div className="relative z-0">
        {CHAPTERS.map((ch, i) => (
          <section
            key={ch.id}
            data-chapter={ch.id}
            className={
              i === 0
                ? "flex min-h-[100dvh] items-center px-4 py-28 opacity-100 sm:px-6 lg:px-8"
                : "flex min-h-[100dvh] items-center px-4 py-28 opacity-0 motion-reduce:opacity-100 sm:px-6 lg:px-8"
            }
          >
            <div className="mx-auto w-full max-w-3xl">
              <p className="text-[0.7rem] font-semibold uppercase tracking-[0.28em] text-primary/90 sm:text-xs">
                {ch.eyebrow}
              </p>
              <h1
                className={
                  i === 0
                    ? "mt-5 whitespace-pre-line text-4xl font-semibold tracking-tight text-balance sm:text-5xl md:text-6xl lg:text-[4rem] lg:leading-[1.05]"
                    : "mt-5 whitespace-pre-line text-3xl font-semibold tracking-tight text-balance sm:text-4xl md:text-5xl lg:leading-[1.08]"
                }
              >
                {ch.title}
              </h1>
              <p className="mt-6 max-w-xl text-base text-muted-foreground text-pretty sm:text-lg">
                {ch.body}
              </p>

              {"waitlist" in ch && ch.waitlist ? (
                <div className="mt-10 max-w-lg">
                  <WaitlistForm showCompany />
                  {i === 0 ? (
                    <div className="mt-5">
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
                  ) : null}
                </div>
              ) : null}

              {i === 0 ? (
                <p className="mt-16 text-[11px] uppercase tracking-[0.22em] text-muted-foreground/70">
                  Scroll
                </p>
              ) : null}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
