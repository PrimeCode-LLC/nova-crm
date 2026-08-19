import type { ReactNode } from "react";
import { Mail, MessageSquareReply, ShieldCheck } from "lucide-react";

import { Logo } from "@/components/marketing/logo";
import { Card, CardContent } from "@/components/ui/card";
import { SITE } from "@/lib/site";

const HIGHLIGHTS = [
  {
    icon: Mail,
    title: "Personalized outbound",
    body: "A plan per prospect — rewritten when they reply, go dark, or say not now.",
  },
  {
    icon: MessageSquareReply,
    title: "Replies with a next move",
    body: "Every inbound classified and drafted before you open the thread.",
  },
  {
    icon: ShieldCheck,
    title: "Under your approval",
    body: "Nova books the meetings. Nothing goes out without you.",
  },
] as const;

export function AuthShell({ children }: { children: ReactNode }) {
  const year = new Date().getFullYear();

  return (
    <div className="relative min-h-dvh bg-background">
      <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="nova-soft-glow absolute top-[-8rem] left-[-4rem] h-[28rem] w-[28rem] rounded-full bg-primary/12 blur-3xl lg:left-[12%]" />
        <div className="absolute right-[-6rem] bottom-[-8rem] h-[22rem] w-[22rem] rounded-full bg-primary/8 blur-3xl" />
      </div>

      <div className="relative mx-auto grid min-h-dvh w-full lg:grid-cols-[minmax(0,1fr)_minmax(0,32rem)] xl:grid-cols-[minmax(0,1fr)_minmax(0,36rem)]">
        <aside className="relative hidden flex-col justify-between border-r border-border/70 px-10 py-10 lg:flex xl:px-16">
          <Logo size="md" />

          <div className="max-w-md space-y-10">
            <div className="space-y-3">
              <p className="text-xs font-medium tracking-[0.18em] text-primary uppercase">
                Sales ops
              </p>
              <h1 className="text-3xl font-semibold tracking-tight text-balance">
                {SITE.tagline}
              </h1>
              <p className="text-sm leading-relaxed text-muted-foreground text-pretty">
                {SITE.oneLiner}
              </p>
            </div>

            <ul className="space-y-5">
              {HIGHLIGHTS.map((item) => (
                <li key={item.title} className="flex gap-3">
                  <span
                    aria-hidden
                    className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"
                  >
                    <item.icon className="size-4" />
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{item.title}</p>
                    <p className="mt-0.5 text-sm text-muted-foreground">{item.body}</p>
                  </div>
                </li>
              ))}
            </ul>
          </div>

          <p className="text-xs text-muted-foreground">
            © {year} {SITE.name}
          </p>
        </aside>

        <div className="flex flex-col items-center justify-center px-4 py-12 sm:px-8 lg:bg-muted/20">
          <div className="mb-8 flex flex-col items-center gap-2 lg:hidden">
            <Logo size="md" />
            <p className="max-w-xs text-center text-sm text-muted-foreground">
              Multi-channel sales ops, finally sane.
            </p>
          </div>

          <Card className="w-full max-w-md py-6 ring-foreground/10">
            <CardContent className="px-6">{children}</CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
