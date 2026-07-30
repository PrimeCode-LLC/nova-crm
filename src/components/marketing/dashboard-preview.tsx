import {
  ArrowUpRight,
  Briefcase,
  Clock,
  DollarSign,
  Mail,
  Network,
  Target,
  Users,
} from "lucide-react";
import { cn } from "@/lib/utils";

const STATS = [
  {
    label: "Open leads",
    value: "31",
    sub: "across channels",
    icon: Users,
    accent: "text-primary",
  },
  {
    label: "Pipeline value",
    value: "$667k",
    sub: "18 open deals",
    icon: DollarSign,
    accent: "text-emerald-400",
  },
  {
    label: "Avg first outreach",
    value: "33m",
    sub: "first outbound",
    icon: Clock,
    accent: "text-amber-400",
  },
  {
    label: "Idle leads",
    value: "12",
    sub: "over threshold",
    icon: Target,
    accent: "text-rose-400",
  },
];

const CHANNELS = [
  {
    name: "Cold Email",
    icon: Mail,
    sent: 108,
    replied: 3,
    rate: "2.8%",
    color: "from-indigo-500 to-blue-500",
  },
  {
    name: "LinkedIn",
    icon: Network,
    sent: 20,
    replied: 4,
    rate: "20%",
    color: "from-cyan-500 to-teal-500",
  },
  {
    name: "Upwork",
    icon: Briefcase,
    sent: 13,
    replied: 2,
    rate: "15%",
    color: "from-fuchsia-500 to-pink-500",
  },
];

export function DashboardPreview() {
  return (
    <div className="overflow-hidden rounded-2xl border border-border/60 bg-card/80 shadow-2xl shadow-black/40 backdrop-blur-xl">
      <div className="flex items-center gap-2 border-b border-border/60 bg-muted/40 px-4 py-3">
        <div className="flex gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-rose-400/70" />
          <span className="h-2.5 w-2.5 rounded-full bg-amber-400/70" />
          <span className="h-2.5 w-2.5 rounded-full bg-emerald-400/70" />
        </div>
        <div className="ml-3 flex h-6 flex-1 items-center justify-center rounded-md bg-background/60 px-3 font-mono text-[11px] text-muted-foreground">
          app.novacrm.com / dashboard
        </div>
      </div>

      <div className="p-5 sm:p-7">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-base font-semibold">Overview</h3>
            <p className="text-xs text-muted-foreground">
              Live pipeline state: last 30 days
            </p>
          </div>
          <div className="hidden items-center gap-2 sm:flex">
            <span className="rounded-md bg-muted px-2 py-1 text-[11px] text-muted-foreground">
              30d
            </span>
          </div>
        </div>

        <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {STATS.map((stat) => (
            <div
              key={stat.label}
              className="rounded-xl border border-border/60 bg-background/60 p-4"
            >
              <div className="flex items-center justify-between">
                <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
                  {stat.label}
                </span>
                <stat.icon className={cn("h-3.5 w-3.5", stat.accent)} />
              </div>
              <div className="mt-2 text-2xl font-semibold tabular-nums">
                {stat.value}
              </div>
              <div className="mt-0.5 text-[11px] text-muted-foreground">
                {stat.sub}
              </div>
            </div>
          ))}
        </div>

        <div className="mt-5 grid gap-4 lg:grid-cols-[2fr_1fr]">
          <div className="rounded-xl border border-border/60 bg-background/60 p-4">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-medium">Activity trend</h4>
              <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-400">
                <ArrowUpRight className="mr-0.5 inline h-2.5 w-2.5" />
                +18%
              </span>
            </div>
            <SparklineMock />
            <div className="mt-3 flex items-center gap-4 text-[11px] text-muted-foreground">
              <Legend color="bg-amber-400" label="Replies" />
              <Legend color="bg-primary" label="Meetings" />
              <Legend color="bg-emerald-400" label="Closed" />
            </div>
          </div>

          <div className="rounded-xl border border-border/60 bg-background/60 p-4">
            <h4 className="text-sm font-medium">Pipeline distribution</h4>
            <div className="mt-3 flex h-2 overflow-hidden rounded-full bg-muted">
              <span className="w-[10%] bg-primary" />
              <span className="w-[10%] bg-cyan-400" />
              <span className="w-[13%] bg-fuchsia-400" />
              <span className="w-[13%] bg-amber-400" />
              <span className="w-[13%] bg-emerald-400" />
              <span className="w-[10%] bg-rose-400" />
              <span className="w-[31%] bg-muted-foreground/30" />
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2 text-[11px]">
              {[
                { label: "New", n: 4, color: "bg-primary" },
                { label: "Contacted", n: 4, color: "bg-cyan-400" },
                { label: "Replied", n: 5, color: "bg-fuchsia-400" },
                { label: "Qualified", n: 5, color: "bg-amber-400" },
                { label: "Discovery", n: 5, color: "bg-emerald-400" },
                { label: "Proposal", n: 4, color: "bg-rose-400" },
              ].map((s) => (
                <div key={s.label} className="flex items-center gap-1.5">
                  <span className={cn("h-1.5 w-1.5 rounded-full", s.color)} />
                  <span className="text-muted-foreground">{s.label}</span>
                  <span className="ml-auto tabular-nums">{s.n}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="mt-5">
          <h4 className="text-sm font-medium">Channel funnels</h4>
          <p className="text-xs text-muted-foreground">
            Each channel&apos;s top-of-funnel conversion
          </p>
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            {CHANNELS.map((ch) => (
              <div
                key={ch.name}
                className="rounded-xl border border-border/60 bg-background/60 p-4"
              >
                <div className="flex items-center gap-2">
                  <span
                    className={cn(
                      "flex h-7 w-7 items-center justify-center rounded-md bg-gradient-to-br text-white",
                      ch.color
                    )}
                  >
                    <ch.icon className="h-3.5 w-3.5" />
                  </span>
                  <span className="text-sm font-medium">{ch.name}</span>
                  <span className="ml-auto rounded-full bg-muted px-2 py-0.5 text-[10px] tabular-nums text-muted-foreground">
                    {ch.rate}
                  </span>
                </div>
                <div className="mt-3 space-y-2">
                  <FunnelBar label="Sent" value={ch.sent} max={ch.sent} />
                  <FunnelBar
                    label="Replied"
                    value={ch.replied}
                    max={ch.sent}
                    accent
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function FunnelBar({
  label,
  value,
  max,
  accent,
}: {
  label: string;
  value: number;
  max: number;
  accent?: boolean;
}) {
  const pct = Math.max(6, (value / max) * 100);
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="w-14 text-muted-foreground">{label}</span>
      <div className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
        <span
          className={cn(
            "absolute inset-y-0 left-0 rounded-full",
            accent ? "bg-primary" : "bg-foreground/40"
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="w-8 text-right tabular-nums text-foreground/70">
        {value}
      </span>
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={cn("h-1.5 w-1.5 rounded-full", color)} />
      {label}
    </span>
  );
}

function SparklineMock() {
  // Simple inline SVG sparkline that visually matches the dashboard's mood.
  return (
    <svg
      viewBox="0 0 400 90"
      className="mt-3 h-24 w-full"
      preserveAspectRatio="none"
      aria-hidden
    >
      <defs>
        <linearGradient id="sparkPrimary" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="oklch(0.7 0.17 265)" stopOpacity="0.45" />
          <stop offset="100%" stopColor="oklch(0.7 0.17 265)" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="sparkAmber" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="oklch(0.78 0.17 85)" stopOpacity="0.35" />
          <stop offset="100%" stopColor="oklch(0.78 0.17 85)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path
        d="M0,75 L40,72 L80,68 L120,52 L160,55 L200,40 L240,42 L280,28 L320,22 L360,18 L400,12 L400,90 L0,90 Z"
        fill="url(#sparkPrimary)"
      />
      <path
        d="M0,75 L40,72 L80,68 L120,52 L160,55 L200,40 L240,42 L280,28 L320,22 L360,18 L400,12"
        fill="none"
        stroke="oklch(0.7 0.17 265)"
        strokeWidth="2"
      />
      <path
        d="M0,82 L40,78 L80,80 L120,70 L160,73 L200,65 L240,68 L280,62 L320,55 L360,48 L400,42 L400,90 L0,90 Z"
        fill="url(#sparkAmber)"
      />
      <path
        d="M0,82 L40,78 L80,80 L120,70 L160,73 L200,65 L240,68 L280,62 L320,55 L360,48 L400,42"
        fill="none"
        stroke="oklch(0.78 0.17 85)"
        strokeWidth="1.5"
      />
    </svg>
  );
}
