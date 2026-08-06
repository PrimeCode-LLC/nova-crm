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
import {
  ArrowRight,
  BellOff,
  BookOpen,
  Check,
  CheckCircle2,
  MessageSquareReply,
  Minus,
  Route,
  ScrollText,
  ShieldCheck,
  Sparkles,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Accordion,
  AccordionContent,
  AccordionHeader,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { cn } from "@/lib/utils";
import {
  GroundingVignette,
  JourneyVignette,
  ReplyVignette,
} from "./feature-vignettes";
import { ProductShot } from "./product-shot";
import { WaitlistForm } from "./waitlist-form";
import { setNovaSceneParams } from "./nova-scene-params";

gsap.registerPlugin(ScrollTrigger);

function clamp01(n: number) {
  return Math.min(1, Math.max(0, n));
}

function sceneFromProgress(p: number) {
  setNovaSceneParams({
    progress: p,
    connect: clamp01(p / 0.45),
    focus: clamp01((p - 0.3) / 0.4),
    settle: clamp01((p - 0.7) / 0.3),
    drift: 0.45 - p * 0.25,
  });
}

const FEATURES = [
  {
    id: "journey",
    icon: Route,
    eyebrow: "Stop babysitting sequences",
    title: "Prospects stop falling through the cracks.",
    body: "Most tools fire the same campaign at everyone. Nova writes a plan per prospect — then rewrites it when they reply, go dark, or say not now.",
    points: [
      "Pauses the moment a reply lands",
      "Waits out an out-of-office, resumes on return",
      "Stops on opt-out — no cleanup sprint for you",
    ],
    Vignette: JourneyVignette,
  },
  {
    id: "replies",
    icon: MessageSquareReply,
    eyebrow: "Inbox that earns its keep",
    title: "Every reply arrives with the next move written.",
    body: "Interest, objections, referrals, delays, meeting asks — classified and scored before you open the thread, with a draft ready to approve.",
    points: [
      "Intent and sentiment on every reply",
      "A next action, not another label in a queue",
      "Approve, edit, or take over in one click",
    ],
    Vignette: ReplyVignette,
  },
  {
    id: "knowledge",
    icon: BookOpen,
    eyebrow: "Your voice. Your facts.",
    title: "Nothing goes out that you could not defend.",
    body: "Every message is written against your services, ICP, case studies, and approved lines — with the sources attached. If Nova cannot ground a claim, it cuts the claim.",
    points: [
      "Cites your real knowledge base",
      "Refuses claims it cannot prove",
      "Same standard across every sender on the team",
    ],
    Vignette: GroundingVignette,
  },
] as const;

const STEPS = [
  {
    n: "01",
    title: "Load what you sell",
    body: "Services, ICP, case studies, and the lines you already approve. Nova works from your world — not a generic prompt.",
  },
  {
    n: "02",
    title: "Bring the list",
    body: "Import prospects, or let Nova help source and enrich them, then route owners without a spreadsheet ritual.",
  },
  {
    n: "03",
    title: "Nova runs the motion",
    body: "Personalised sequences, follow-ups, and timing decided per prospect — while you stay on the deals that need a human.",
  },
  {
    n: "04",
    title: "You approve what matters",
    body: "Replies land classified, scored, and drafted. Approve, edit, or step in. Nothing sends unless you say so.",
  },
] as const;

const CONTROLS = [
  {
    icon: CheckCircle2,
    title: "Nothing sends without you",
    body: "Approval gates on drafts and sequences. Review everything, first sends only, or loosen the reins when you trust the motion.",
  },
  {
    icon: BellOff,
    title: "Opt-out and absence aware",
    body: "Suppressions are honoured automatically. Follow-ups pause through an out-of-office instead of piling into a mess.",
  },
  {
    icon: ShieldCheck,
    title: "Your workspace stays yours",
    body: "Every record is scoped to your company. Client data and pipeline never bleed across teams or tenants.",
  },
  {
    icon: ScrollText,
    title: "Full audit trail",
    body: "Every send, classification, and decision is logged — attributable to a person or to Nova.",
  },
] as const;

/**
 * Volume figures match the hero board. Cost framing is qualitative on purpose —
 * we will not invent salary numbers we cannot defend.
 */
const BY_HAND = [
  "A hire writing ~2,000 personalised emails a month",
  "Someone reading and triaging every reply that lands",
  "Someone chasing thousands of follow-ups so none slip",
  "You (or enablement) policing every claim before it ships",
  "Headcount that climbs every time volume climbs",
] as const;

const WITH_NOVA = [
  "Sequences written per prospect from your knowledge base",
  "Replies classified, scored, and drafted before you open the inbox",
  "Follow-ups that pause, resume, and never drop",
  "Unsupported claims removed before a message goes out",
  "One system — volume grows; the headcount line does not",
] as const;

const FAQS = [
  {
    q: "Is Nova a CRM, or does it sit on top of one?",
    a: "Both, in one place. Pipeline, companies, contacts, and deals live in Nova, and the execution engine runs against the same records — so there is no sync to maintain and no drift between what your CRM says and what actually happened.",
  },
  {
    q: "Do I lose control of what gets sent?",
    a: "No. Nova proposes; you decide. Sequences and reply drafts sit behind approval gates you configure, and you can take over any conversation without breaking the journey.",
  },
  {
    q: "What stops it inventing things about my business?",
    a: "Messages are generated against your knowledge base and carry the sources used. When Nova cannot ground a claim in something you gave it, it removes the claim rather than guessing.",
  },
  {
    q: "How does it protect deliverability?",
    a: "Sending is paced per mailbox with volume caps and warm-up, bounces are surfaced for review, and opt-outs and hard bounces are suppressed across the workspace immediately.",
  },
  {
    q: "What happens the moment a prospect replies?",
    a: "The sequence pauses instantly. The reply is classified for intent and sentiment, scored for priority, and paired with a next action and a draft — so the follow-up is waiting instead of still needing to be written.",
  },
  {
    q: "Who is Nova built for?",
    a: "Owners and founders of B2B service businesses and SaaS companies who are running outbound with more pipeline than headcount — and still need every prospect handled with judgement, not a blast.",
  },
  {
    q: "What do founding members get?",
    a: "A capped first cohort, founding pricing locked for as long as you stay, and hands-on onboarding from Stellix Soft so you are not left alone with an empty workspace.",
  },
] as const;

function CanvasFallback({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={className}
      style={{
        background:
          "radial-gradient(ellipse 90% 65% at 50% 105%, oklch(0.52 0.19 268 / 0.5), oklch(0.3 0.14 270 / 0.18) 45%, transparent 72%)",
      }}
    />
  );
}

export function PremiumLanding() {
  const rootRef = useRef<HTMLDivElement>(null);
  const heroRef = useRef<HTMLElement>(null);
  const [NovaCanvas, setNovaCanvas] = useState<ComponentType<{
    className?: string;
  }> | null>(null);

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
    const hero = heroRef.current;
    if (!root) return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const reveals = gsap.utils.toArray<HTMLElement>(
      root.querySelectorAll("[data-reveal]"),
    );

    const ctx = gsap.context(() => {
      if (hero && !reduced) {
        ScrollTrigger.create({
          trigger: hero,
          start: "top top",
          end: "bottom top",
          scrub: 0.7,
          onUpdate: (self) => sceneFromProgress(self.progress),
        });
      }

      if (reduced) {
        sceneFromProgress(0.4);
        gsap.set(reveals, { opacity: 1, y: 0 });
        return;
      }

      reveals.forEach((el) => {
        gsap.fromTo(
          el,
          { opacity: 0, y: 28 },
          {
            opacity: 1,
            y: 0,
            duration: 0.9,
            ease: "power3.out",
            scrollTrigger: {
              trigger: el,
              start: "top 85%",
              toggleActions: "play none none reverse",
            },
          },
        );
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
        drift: 0.4,
      });
    };
  }, []);

  return (
    <div ref={rootRef} className="relative">
      <section
        ref={heroRef}
        className="relative isolate -mt-16 flex min-h-[100dvh] flex-col overflow-hidden"
      >
        {/* Atmosphere: the dome sits in a lit sky, not on flat black */}
        <div
          aria-hidden
          className="absolute inset-0 -z-30"
          style={{
            background:
              "radial-gradient(ellipse 130% 52% at 50% 56%, oklch(0.5 0.2 268) 0%, oklch(0.33 0.15 270) 26%, oklch(0.22 0.09 270) 50%, oklch(0.16 0.04 270) 76%, oklch(0.14 0 0) 100%)",
          }}
        />

        {/* Hard-lands the lit sky into the page background at the section seam */}
        <div
          aria-hidden
          className="absolute inset-x-0 bottom-0 -z-[5] h-72 bg-gradient-to-b from-transparent to-background"
        />

        {/* Pinned to the viewport, not the section: the product shot makes the
            hero taller than one screen, and a canvas that grew with it would
            re-frame the dome down to an invisible sliver. */}
        {NovaCanvas ? (
          <NovaCanvas className="absolute inset-x-0 top-0 -z-20 h-[100dvh] w-full" />
        ) : (
          <CanvasFallback className="absolute inset-x-0 top-0 -z-20 h-[100dvh] w-full" />
        )}

        {/* Vignette keeps the dome's cropped edges from reading as a cutout */}
        <div
          aria-hidden
          className="absolute inset-0 -z-10"
          style={{
            background:
              "radial-gradient(ellipse 88% 66% at 50% 40%, transparent 30%, oklch(0.1 0.02 270 / 0.5) 100%)",
          }}
        />

        {/* Copy sits over the dome's brightest band; without this it greys out */}
        <div
          aria-hidden
          className="absolute inset-0 -z-10"
          style={{
            background:
              "radial-gradient(ellipse 58% 33% at 50% 26%, oklch(0.1 0.02 270 / 0.9) 0%, oklch(0.1 0.02 270 / 0.66) 42%, oklch(0.1 0.02 270 / 0.26) 70%, transparent 88%)",
          }}
        />

        <div className="relative flex flex-1 flex-col items-center px-4 pt-28 text-center sm:px-6 sm:pt-32 lg:pt-36">
          <div data-reveal className="flex w-full max-w-4xl flex-col items-center">
            <div className="inline-flex items-center gap-2 rounded-full border border-white/12 bg-white/[0.06] px-3.5 py-1.5 text-xs text-white/70 backdrop-blur-md">
              <Sparkles className="h-3 w-3 text-primary" />
              Founding cohort · 25 teams
            </div>

            <h1 className="mt-7 text-balance text-[2.25rem] font-semibold leading-[1.04] tracking-[-0.035em] sm:text-6xl sm:leading-[1.02] lg:text-[4.75rem]">
              Nova books the meetings.
              <span className="block text-white/70">
                You stop hiring another SDR.
              </span>
            </h1>

            <p className="mt-6 max-w-xl text-pretty text-base text-white/72 sm:text-lg">
              For B2B service and SaaS owners carrying more pipeline than
              headcount. Nova writes, follows up, reads every reply, and advances
              the deal — grounded in how you actually sell.
            </p>

            <div className="relative isolate mt-9 flex flex-col items-center gap-3 sm:flex-row">
              {/* On narrow screens the dome's bright rim lands directly behind
                  the CTAs. Anchored to the buttons so it holds at any height. */}
              <div
                aria-hidden
                className="pointer-events-none absolute -inset-x-10 -inset-y-6 -z-10 bg-[radial-gradient(ellipse_at_center,oklch(0.1_0.02_270/0.8)_0%,oklch(0.1_0.02_270/0.5)_55%,transparent_78%)] blur-lg sm:hidden"
              />
              <Button
                size="lg"
                className="h-12 rounded-full px-7 text-sm"
                nativeButton={false}
                render={<Link href="#waitlist" />}
              >
                Reserve a founding slot
                <ArrowRight />
              </Button>
              <Button
                size="lg"
                variant="outline"
                className="h-12 rounded-full border-white/15 bg-background/70 px-7 text-sm backdrop-blur-md hover:bg-background/85"
                nativeButton={false}
                render={<Link href="#journey" />}
              >
                See how it works
              </Button>
            </div>
            <p className="mt-4 text-xs text-white/50">
              Founding pricing locked · we onboard you · no credit card
            </p>
          </div>

          {/* Product, cropped by the fold — the strongest premium signal here */}
          <div
            data-reveal
            className="mt-14 w-full max-w-5xl sm:mt-16"
            style={{ perspective: "2200px" }}
          >
            <div
              className="relative -mb-24 origin-top text-left [mask-image:linear-gradient(to_bottom,black_58%,transparent_100%)]"
              style={{ transform: "rotateX(7deg)" }}
            >
              <div
                aria-hidden
                className="absolute -inset-x-16 -top-10 -z-10 h-40 bg-[radial-gradient(ellipse_60%_100%_at_50%_0%,oklch(0.6_0.2_268/0.45),transparent_70%)] blur-2xl"
              />
              <ProductShot />
            </div>
          </div>
        </div>
      </section>

      {/* Feature rows */}
      <div className="relative bg-background">
        {/* Honest proof — no invented metrics. Stellix Soft runs Nova in production. */}
        <section className="px-4 pb-4 pt-6 sm:px-6">
          <p
            data-reveal
            className="mx-auto max-w-3xl text-center text-sm leading-relaxed text-muted-foreground"
          >
            Built by{" "}
            <span className="text-foreground">Stellix Soft</span> — and running
            our own outbound on Nova every day. We ship what we use.
          </p>
        </section>

        {FEATURES.map((f, i) => (
          <section
            key={f.id}
            id={f.id}
            data-section={f.id}
            className={cn(
              "px-4 py-20 sm:px-6 lg:py-28",
              // The hero's lit sky should dissolve into the page, not butt
              // against a rule.
              i > 0 && "border-t border-border/40",
            )}
          >
            <div
              data-reveal
              className="mx-auto grid w-full max-w-6xl items-center gap-10 lg:grid-cols-2 lg:gap-16"
            >
              <div className={cn(i % 2 === 1 && "lg:order-2")}>
                <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-border/60 bg-card/50 text-primary">
                  <f.icon className="h-5 w-5" />
                </div>
                <p className="mt-5 text-[0.7rem] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
                  {f.eyebrow}
                </p>
                <h2 className="mt-3 text-balance text-2xl font-semibold tracking-tight sm:text-4xl">
                  {f.title}
                </h2>
                <p className="mt-4 max-w-xl text-base leading-relaxed text-muted-foreground">
                  {f.body}
                </p>
                <ul className="mt-6 space-y-2.5">
                  {f.points.map((point) => (
                    <li key={point} className="flex items-start gap-2.5 text-sm">
                      <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                      <span className="text-muted-foreground">{point}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <div className={cn("min-w-0", i % 2 === 1 && "lg:order-1")}>
                <f.Vignette />
              </div>
            </div>
          </section>
        ))}

        {/* How it works */}
        <section className="border-t border-border/40 px-4 py-20 sm:px-6 lg:py-28">
          <div data-reveal className="mx-auto w-full max-w-6xl">
            <p className="text-[0.7rem] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
              How it works
            </p>
            <h2 className="mt-3 max-w-2xl text-balance text-2xl font-semibold tracking-tight sm:text-4xl">
              Live in days. Running without you babysitting it.
            </h2>
            <div className="mt-12 grid gap-x-8 gap-y-10 sm:grid-cols-2 lg:grid-cols-4">
              {STEPS.map((step) => (
                <div key={step.n} className="relative">
                  <span className="font-mono text-xs font-semibold tracking-[0.2em] text-primary/80">
                    {step.n}
                  </span>
                  <div
                    aria-hidden
                    className="mt-3 h-px w-full bg-gradient-to-r from-primary/40 to-transparent"
                  />
                  <h3 className="mt-4 text-base font-semibold">{step.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                    {step.body}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Control and trust — the standing objection to autonomous outreach */}
        <section className="border-t border-border/40 px-4 py-20 sm:px-6 lg:py-28">
          <div data-reveal className="mx-auto w-full max-w-6xl">
            <p className="text-[0.7rem] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
              The risk you already worry about
            </p>
            <h2 className="mt-3 max-w-2xl text-balance text-2xl font-semibold tracking-tight sm:text-4xl">
              Autonomous outbound — with a handbrake.
            </h2>
            <div className="mt-12 grid gap-x-10 gap-y-8 sm:grid-cols-2">
              {CONTROLS.map((item) => (
                <div key={item.title} className="flex gap-4">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border/60 bg-card/50 text-primary">
                    <item.icon className="h-4 w-4" />
                  </div>
                  <div className="min-w-0">
                    <h3 className="text-base font-semibold">{item.title}</h3>
                    <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                      {item.body}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Value anchor — headcount absorbed, not a price tag */}
        <section className="border-t border-border/40 px-4 py-20 sm:px-6 lg:py-28">
          <div data-reveal className="mx-auto w-full max-w-6xl">
            <p className="text-[0.7rem] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
              What you stop paying for
            </p>
            <h2 className="mt-3 max-w-2xl text-balance text-2xl font-semibold tracking-tight sm:text-4xl">
              Cheaper than the hire you were about to make.
            </h2>
            <p className="mt-4 max-w-xl text-base leading-relaxed text-muted-foreground">
              Another SDR or VA absorbs salary, ramp time, and quality variance.
              Nova absorbs the writing, the reading, the chasing, and the brand
              risk — at a fraction of that cost.
            </p>

            <div className="mt-12 grid gap-4 lg:grid-cols-2 lg:gap-6">
              <div className="rounded-2xl border border-border/60 bg-card/30 p-6">
                <div className="flex items-center gap-2.5">
                  <Users className="h-4 w-4 text-muted-foreground" />
                  <h3 className="text-sm font-semibold text-muted-foreground">
                    Doing it by hand
                  </h3>
                </div>
                <ul className="mt-5 space-y-3">
                  {BY_HAND.map((item) => (
                    <li key={item} className="flex items-start gap-3 text-sm">
                      <Minus className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground/50" />
                      <span className="text-muted-foreground">{item}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="relative rounded-2xl border border-primary/25 bg-primary/[0.04] p-6">
                <div
                  aria-hidden
                  className="pointer-events-none absolute inset-0 -z-10 rounded-2xl bg-[radial-gradient(ellipse_70%_60%_at_50%_0%,oklch(0.5_0.2_268/0.12),transparent_70%)]"
                />
                <div className="flex items-center gap-2.5">
                  <Sparkles className="h-4 w-4 text-primary" />
                  <h3 className="text-sm font-semibold">With Nova</h3>
                </div>
                <ul className="mt-5 space-y-3">
                  {WITH_NOVA.map((item) => (
                    <li key={item} className="flex items-start gap-3 text-sm">
                      <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            <div className="mt-8 flex flex-col items-start gap-4 sm:flex-row sm:items-center">
              <p className="text-sm text-muted-foreground">
                Founding cohort pricing is locked for life for the first 25
                teams. Tell us your volume and we&apos;ll quote your seat.
              </p>
              <Button
                variant="outline"
                className="shrink-0 rounded-full"
                nativeButton={false}
                render={<Link href="#waitlist" />}
              >
                Claim a founding slot
                <ArrowRight />
              </Button>
            </div>
          </div>
        </section>

        {/* FAQ */}
        <section className="border-t border-border/40 px-4 py-20 sm:px-6 lg:py-28">
          <div
            data-reveal
            className="mx-auto grid w-full max-w-6xl gap-10 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] lg:gap-16"
          >
            <div>
              <p className="text-[0.7rem] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
                Questions
              </p>
              <h2 className="mt-3 text-balance text-2xl font-semibold tracking-tight sm:text-4xl">
                Straight answers before you commit.
              </h2>
              <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
                Something not covered here?{" "}
                <a
                  href="mailto:sales@stellixsoft.com"
                  className="text-foreground underline underline-offset-4 hover:text-primary"
                >
                  Ask us directly.
                </a>
              </p>
            </div>
            <Accordion className="border-t border-border/40">
              {FAQS.map((faq) => (
                <AccordionItem key={faq.q} value={faq.q} className="border-b">
                  <AccordionHeader>
                    <AccordionTrigger className="py-4 text-base">
                      {faq.q}
                    </AccordionTrigger>
                  </AccordionHeader>
                  <AccordionContent className="pb-4 pr-8 text-sm leading-relaxed text-muted-foreground">
                    {faq.a}
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          </div>
        </section>

        {/* Closing CTA — bookends the hero so the page closes where it opened */}
        <section
          id="waitlist"
          className="relative isolate overflow-hidden border-t border-border/40 px-4 py-24 sm:px-6 lg:py-32"
        >
          <div
            aria-hidden
            className="absolute inset-0 -z-10"
            style={{
              background:
                // Haloed on the CTA rather than the section edge: a glow centred
                // past the bottom gets clipped and seams into the footer.
                "radial-gradient(ellipse 72% 58% at 50% 56%, oklch(0.46 0.19 268 / 0.4) 0%, oklch(0.3 0.13 270 / 0.18) 42%, transparent 74%)",
            }}
          />

          <div data-reveal className="mx-auto w-full max-w-2xl text-center">
            <p className="text-[0.7rem] font-semibold uppercase tracking-[0.28em] text-primary/90">
              Founding cohort · 25 teams
            </p>
            <h2 className="mt-4 text-balance text-3xl font-semibold tracking-tight sm:text-5xl">
              Stop managing the prospect journey.
              <span className="mt-1 block text-white/60">Start owning the meetings.</span>
            </h2>
            <p className="mx-auto mt-5 max-w-lg text-pretty text-muted-foreground">
              Reserve a slot. We onboard you, lock founding pricing for as long
              as you stay, and put Nova on your outbound — not another empty
              tool in the stack.
            </p>

            <div className="mx-auto mt-9 max-w-xl rounded-2xl border border-white/10 bg-white/[0.03] p-5 text-left backdrop-blur-xl">
              <WaitlistForm
                showCompany
                ctaLabel="Reserve my founding slot"
              />
              <p className="mt-3.5 text-center text-xs text-muted-foreground">
                Limited to 25 founding teams. No credit card. Questions?{" "}
                <a
                  href="mailto:sales@stellixsoft.com"
                  className="underline underline-offset-2 hover:text-foreground"
                >
                  sales@stellixsoft.com
                </a>
              </p>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
