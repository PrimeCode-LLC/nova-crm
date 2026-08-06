"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Archive,
  Bell,
  Building2,
  Calendar,
  CalendarClock,
  CalendarDays,
  CalendarPlus,
  ChevronDown,
  CircleDollarSign,
  Contact,
  Crosshair,
  Download,
  FileText,
  Filter,
  GitBranch,
  Inbox,
  LayoutDashboard,
  LayoutGrid,
  ListTodo,
  MessageSquareReply,
  MessagesSquare,
  Monitor,
  PanelLeft,
  PauseCircle,
  Plus,
  Search,
  ScrollText,
  Send,
  Settings,
  Sparkles,
  UserRoundSearch,
  Users,
  Workflow,
  type LucideIcon,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { KpiCard } from "@/components/common/kpi-card";
import { cn } from "@/lib/utils";

/**
 * Static replica of the authenticated Overview board, for marketing surfaces.
 *
 * Deliberately not the real dashboard components: those are client trees bound
 * to useWorkspace()/useOrgTimezone() and Recharts, which would drag app domain
 * types and a charting bundle onto the landing page. Shared primitives
 * (Card, KpiCard) are reused so the visual language cannot drift.
 */

const DESIGN_WIDTH = 1440;
const DESIGN_HEIGHT = 980;

const RAIL_ICONS: LucideIcon[] = [
  LayoutDashboard,
  MessageSquareReply,
  Users,
  UserRoundSearch,
  Archive,
  Crosshair,
  Download,
  GitBranch,
  Building2,
  Contact,
  CircleDollarSign,
  CalendarClock,
  CalendarDays,
  ListTodo,
  FileText,
  ScrollText,
  Send,
  Inbox,
  Bell,
  MessagesSquare,
  Settings,
];

type Hint = { text: string; tone?: "danger" | "warn" | "success" | "info" | "accent" };

function HintLine({ parts }: { parts: Hint[] }) {
  return (
    <span className="inline-flex flex-wrap items-baseline gap-x-1">
      {parts.map((part, i) => (
        <span key={part.text} className="inline-flex items-baseline gap-x-1">
          {i > 0 ? <span className="text-muted-foreground/50">·</span> : null}
          <span
            className={cn(
              part.tone === "danger" && "font-medium text-destructive",
              part.tone === "warn" && "font-medium text-warning",
              part.tone === "success" && "font-medium text-success",
              part.tone === "info" && "font-medium text-chart-1",
              part.tone === "accent" && "font-medium text-chart-2",
            )}
          >
            {part.text}
          </span>
        </span>
      ))}
    </span>
  );
}

/** Outcomes first — activity KPIs sit further right so the hero sells results. */
const KPIS = [
  {
    label: "Meetings today",
    value: "6",
    icon: Calendar,
    tone: "success" as const,
    hints: [{ text: "booked from replies", tone: "success" as const }],
  },
  {
    label: "Replies",
    value: "214",
    icon: MessageSquareReply,
    tone: "accent" as const,
    hints: [{ text: "18 to review", tone: "warn" as const }],
  },
  {
    label: "Emails sent",
    value: "1,998",
    icon: Send,
    tone: "info" as const,
    hints: [
      { text: "1,204 opened", tone: "success" as const },
      { text: "0 failed" },
    ],
  },
  {
    label: "Follow-ups due",
    value: "446",
    icon: CalendarClock,
    tone: "warn" as const,
    hints: [
      { text: "0 overdue" },
      { text: "4,600 in sequence", tone: "info" as const },
    ],
  },
  {
    label: "Prospects",
    value: "1,921",
    icon: UserRoundSearch,
    tone: "default" as const,
    hints: [
      { text: "46 ready to push", tone: "warn" as const },
      { text: "1,875 pushed", tone: "success" as const },
    ],
  },
  {
    label: "Open tasks",
    value: "12",
    icon: ListTodo,
    tone: "default" as const,
    hints: [{ text: "0 overdue" }],
  },
];

const DAYS = ["Fri", "Sat", "Sun", "Mon", "Tue", "Wed", "Thu"];
const SENT = [96, 168, 268, 330, 296, 210, 132];
const OPENED = [58, 104, 172, 214, 190, 132, 84];
const REPLIES = [8, 14, 26, 34, 30, 21, 13];
const VOLUME_MAX = 360;

/** Catmull-Rom-ish smoothing; straight polylines read as a wireframe, not a product. */
function linePath(values: number[], w: number, h: number, max: number) {
  const step = w / (values.length - 1);
  const pts = values.map((v, i) => [i * step, h - (v / max) * h] as const);
  let d = `M ${pts[0][0]} ${pts[0][1]}`;
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1];
    const [x1, y1] = pts[i];
    const cx = (x0 + x1) / 2;
    d += ` C ${cx} ${y0}, ${cx} ${y1}, ${x1} ${y1}`;
  }
  return d;
}

function areaPath(values: number[], w: number, h: number, max: number) {
  return `${linePath(values, w, h, max)} L ${w} ${h} L 0 ${h} Z`;
}

function EmailVolumeCard() {
  const w = 620;
  const h = 210;
  return (
    <Card className="gap-3">
      <CardHeader className="pb-0">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="text-sm font-semibold">Email volume</CardTitle>
            <CardDescription className="text-[11px]">
              Sent · opens · replies · bounces · 1,998 sent · 1,204 opened · 214
              replies · 6 bounced
            </CardDescription>
          </div>
          <div className="flex shrink-0 items-center gap-0.5 rounded-md bg-muted/60 p-0.5 text-[10px]">
            {["Today", "Week", "Month"].map((tab) => (
              <span
                key={tab}
                className={cn(
                  "rounded px-2 py-1",
                  tab === "Week"
                    ? "bg-background font-medium text-foreground shadow-sm"
                    : "text-muted-foreground",
                )}
              >
                {tab}
              </span>
            ))}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="flex gap-2">
          <div className="flex flex-col justify-between py-1 text-[9px] tabular-nums text-muted-foreground">
            {[360, 240, 120, 0].map((n) => (
              <span key={n}>{n}</span>
            ))}
          </div>
          <div className="min-w-0 flex-1">
            <svg
              viewBox={`0 0 ${w} ${h}`}
              className="h-[168px] w-full"
              preserveAspectRatio="none"
            >
              <defs>
                <linearGradient id="nova-sent" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--chart-1)" stopOpacity="0.55" />
                  <stop offset="100%" stopColor="var(--chart-1)" stopOpacity="0.02" />
                </linearGradient>
                <linearGradient id="nova-opened" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--chart-2)" stopOpacity="0.4" />
                  <stop offset="100%" stopColor="var(--chart-2)" stopOpacity="0.02" />
                </linearGradient>
              </defs>
              {[0, 1, 2, 3].map((i) => (
                <line
                  key={i}
                  x1="0"
                  x2={w}
                  y1={(h / 3) * i}
                  y2={(h / 3) * i}
                  stroke="var(--border)"
                  strokeWidth="1"
                  strokeDasharray="3 4"
                />
              ))}
              <path d={areaPath(SENT, w, h, VOLUME_MAX)} fill="url(#nova-sent)" />
              <path
                d={linePath(SENT, w, h, VOLUME_MAX)}
                fill="none"
                stroke="var(--chart-1)"
                strokeWidth="2"
              />
              <path d={areaPath(OPENED, w, h, VOLUME_MAX)} fill="url(#nova-opened)" />
              <path
                d={linePath(OPENED, w, h, VOLUME_MAX)}
                fill="none"
                stroke="var(--chart-2)"
                strokeWidth="1.75"
              />
              <path
                d={linePath(REPLIES, w, h, VOLUME_MAX)}
                fill="none"
                stroke="var(--chart-3)"
                strokeWidth="1.5"
              />
            </svg>
            <div className="mt-1 flex justify-between text-[9px] text-muted-foreground">
              {DAYS.map((d) => (
                <span key={d}>{d}</span>
              ))}
            </div>
          </div>
        </div>
        <div className="mt-2 flex items-center gap-3 text-[10px] text-muted-foreground">
          <Legend color="var(--chart-1)" label="Sent" />
          <Legend color="var(--chart-2)" label="Opens" />
          <Legend color="var(--chart-3)" label="Replies" />
          <Legend color="var(--chart-4)" label="Bounces" />
        </div>
      </CardContent>
    </Card>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className="h-1.5 w-1.5 rounded-full"
        style={{ backgroundColor: color }}
      />
      {label}
    </span>
  );
}

const DONE = [18, 26, 12, 34, 22, 41, 28, 16, 30, 24, 38, 20, 33, 27, 19, 36, 23, 31];
const SCHEDULED = [30, 41, 22, 52, 36, 58, 44, 27, 47, 39, 55, 33, 49, 42, 31, 54, 37, 46];
const BAR_MAX = 64;

function FollowupScheduleCard() {
  return (
    <Card className="gap-3">
      <CardHeader className="pb-0">
        <CardTitle className="text-sm font-semibold">
          Follow-ups this month
        </CardTitle>
        <CardDescription className="text-[11px]">
          August 2026 · 5,613 upcoming · 0 overdue · 1,284 done
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex gap-2">
          <div className="flex flex-col justify-between py-1 text-[9px] tabular-nums text-muted-foreground">
            {[60, 40, 20, 0].map((n) => (
              <span key={n}>{n}</span>
            ))}
          </div>
          <div className="flex h-[168px] min-w-0 flex-1 items-end gap-[3px] border-b border-border/60">
            {SCHEDULED.map((s, i) => (
              <div key={i} className="flex h-full flex-1 items-end gap-[2px]">
                <div
                  className="flex-1 rounded-t-[2px] bg-success/80"
                  style={{ height: `${(DONE[i] / BAR_MAX) * 100}%` }}
                />
                <div
                  className="flex-1 rounded-t-[2px] bg-chart-1/85"
                  style={{ height: `${(s / BAR_MAX) * 100}%` }}
                />
              </div>
            ))}
          </div>
        </div>
        <div className="mt-2 flex items-center gap-3 text-[10px] text-muted-foreground">
          <Legend color="var(--success)" label="Done" />
          <Legend color="var(--chart-1)" label="Scheduled" />
          <Legend color="var(--destructive)" label="Overdue" />
        </div>
      </CardContent>
    </Card>
  );
}

const TEAM = [
  {
    rank: 1,
    name: "Alex Morgan",
    score: 89,
    delta: "+34",
    bar: 100,
    stats: "Prospects 184 · Leads 26 · Sent 968 · Replies 104",
    money: "Pipeline added $128,400 · Won $24,000",
  },
  {
    rank: 2,
    name: "Daniel Reed",
    score: 76,
    delta: "+18",
    bar: 82,
    stats: "Prospects 427 · Leads 19 · Sent 578 · Replies 61",
    money: "Pipeline added $86,200 · Won $12,500",
  },
  {
    rank: 3,
    name: "Olivia Bennett",
    score: 64,
    delta: "+22",
    bar: 66,
    stats: "Prospects 226 · Leads 14 · Sent 269 · Replies 38",
    money: "Pipeline added $54,000 · Won $8,000",
  },
  {
    rank: 4,
    name: "James Whitfield",
    score: 51,
    delta: "+11",
    bar: 52,
    stats: "Prospects 155 · Leads 11 · Sent 186 · Replies 27",
    money: "Pipeline added $41,500 · Won $6,000",
  },
];

function initials(name: string) {
  return name
    .split(" ")
    .map((p) => p[0])
    .join("")
    .slice(0, 2);
}

function TeamCommandCard() {
  return (
    <Card className="gap-3">
      <CardHeader className="pb-0">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="text-sm font-semibold">Team command</CardTitle>
            <CardDescription className="text-[11px]">
              Relative activity across prospecting, outreach, follow-ups &amp;
              closing · Team-relative score · Last 30 days
            </CardDescription>
          </div>
          <div className="flex shrink-0 items-center gap-3 text-[10px]">
            <div className="flex items-center gap-0.5 rounded-md bg-muted/60 p-0.5">
              {["Today", "12h", "24h", "7d", "30d", "All"].map((t) => (
                <span
                  key={t}
                  className={cn(
                    "rounded px-1.5 py-1",
                    t === "30d"
                      ? "bg-background font-medium text-foreground shadow-sm"
                      : "text-muted-foreground",
                  )}
                >
                  {t}
                </span>
              ))}
            </div>
            <div className="flex items-center gap-0.5 rounded-md bg-muted/60 p-0.5">
              {["Overall", "Prospecting", "Outreach", "Follow-ups", "Closing"].map(
                (t) => (
                  <span
                    key={t}
                    className={cn(
                      "rounded px-1.5 py-1",
                      t === "Overall"
                        ? "bg-background font-medium text-foreground shadow-sm"
                        : "text-muted-foreground",
                    )}
                  >
                    {t}
                  </span>
                ),
              )}
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center gap-2">
          {TEAM.map((m) => (
            <span
              key={m.name}
              className="inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-muted/30 py-0.5 pl-0.5 pr-2 text-[10px]"
            >
              <span className="flex h-4 w-4 items-center justify-center rounded-full bg-chart-1/20 text-[8px] font-medium text-chart-1">
                {initials(m.name)}
              </span>
              {m.name}
              <span className="text-muted-foreground">{m.score}</span>
            </span>
          ))}
        </div>

        {TEAM.map((m) => (
          <div key={m.name} className="flex items-center gap-3">
            <span className="w-3 shrink-0 text-[11px] tabular-nums text-muted-foreground">
              {m.rank}
            </span>
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-chart-1/20 text-[9px] font-medium text-chart-1">
              {initials(m.name)}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-3">
                <p className="truncate text-xs font-medium">{m.name}</p>
                <span className="shrink-0 text-[11px] tabular-nums">
                  <span className="font-semibold">{m.score}</span>{" "}
                  <span className="text-success">{m.delta}</span>
                </span>
              </div>
              <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-chart-1"
                  style={{ width: `${m.bar}%` }}
                />
              </div>
              <p className="mt-1 text-[10px] text-muted-foreground">
                {m.stats}
              </p>
              <p className="text-[10px] text-muted-foreground/80">{m.money}</p>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

const FEED: { icon: LucideIcon; summary: string; actor: string; when: string }[] = [
  {
    icon: Workflow,
    summary: "Scheduled sequences for 50 leads (184 emails)",
    actor: "Hannah Clarke",
    when: "2 min ago",
  },
  {
    icon: Sparkles,
    summary: "Reply classified: interested — draft ready to approve",
    actor: "Nova",
    when: "3 min ago",
  },
  {
    icon: CalendarPlus,
    summary: "Meeting booked with Emily Hartley · Northwind Health",
    actor: "Nova",
    when: "5 min ago",
  },
  {
    icon: Send,
    summary: "Scheduled follow-up: Email 4 — Gracious Breakup",
    actor: "Nova",
    when: "7 min ago",
  },
  {
    icon: Workflow,
    summary: "Scheduled sequences for 8 leads (32 emails)",
    actor: "Alex Morgan",
    when: "9 min ago",
  },
  {
    icon: PauseCircle,
    summary: "Paused sequence — out of office until 18 Aug",
    actor: "Nova",
    when: "12 min ago",
  },
  {
    icon: Sparkles,
    summary: "Reply classified: pricing objection — draft ready",
    actor: "Nova",
    when: "15 min ago",
  },
  {
    icon: Send,
    summary: "Scheduled follow-up: Email 1 — Acknowledgement and Idea",
    actor: "Daniel Reed",
    when: "18 min ago",
  },
  {
    icon: Archive,
    summary: "Auto-archived 6 leads after opt-out",
    actor: "Nova",
    when: "21 min ago",
  },
  {
    icon: Workflow,
    summary: "Scheduled sequences for 10 leads (40 emails)",
    actor: "Olivia Bennett",
    when: "24 min ago",
  },
  {
    icon: Send,
    summary: "Scheduled follow-up: Email 2 — Value Proposition",
    actor: "Nova",
    when: "27 min ago",
  },
  {
    icon: Crosshair,
    summary: "Built 33 sequences from Enterprise Ops strategy",
    actor: "James Whitfield",
    when: "31 min ago",
  },
];

function LiveActivityCard() {
  return (
    <Card className="flex h-full min-h-0 flex-col gap-3">
      <CardHeader className="shrink-0 pb-0">
        <CardTitle className="text-sm font-semibold">Live activity</CardTitle>
        <CardDescription className="text-[11px]">
          Prospects, outreach, follow-ups, scrapers, strategy, and imports
        </CardDescription>
      </CardHeader>
      <CardContent className="min-h-0 flex-1 overflow-hidden">
        <div className="space-y-0.5">
          {FEED.map((item, i) => (
            <div
              key={item.summary}
              className="flex animate-in gap-2.5 rounded-md px-2 py-2 fade-in slide-in-from-right-2 fill-mode-both duration-700"
              style={{ animationDelay: `${400 + i * 110}ms` }}
            >
              <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted">
                <item.icon className="h-3.5 w-3.5 text-muted-foreground" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-xs leading-snug text-foreground">
                  {item.summary}
                </p>
                <div className="mt-1 flex items-center gap-2 text-[10px] text-muted-foreground">
                  <span className="inline-flex items-center gap-1">
                    <span
                      className={cn(
                        "flex h-3.5 w-3.5 items-center justify-center rounded-full text-[7px] font-medium",
                        item.actor === "Nova"
                          ? "bg-primary/20 text-primary"
                          : "bg-muted-foreground/20 text-muted-foreground",
                      )}
                    >
                      {item.actor === "Nova" ? "N" : initials(item.actor)}
                    </span>
                    {item.actor}
                  </span>
                  <span>{item.when}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function TopBar() {
  return (
    <div className="flex h-11 shrink-0 items-center gap-3 border-b border-border/60 px-3">
      <PanelLeft className="h-3.5 w-3.5 text-muted-foreground" />
      <span className="text-xs font-medium">Dashboard</span>
      <div className="ml-auto flex items-center gap-2 text-[11px] text-muted-foreground">
        <span className="tabular-nums">9:41 AM GMT</span>
        <span className="inline-flex items-center gap-1.5 rounded-md border border-border/60 px-2 py-1">
          <span className="h-3.5 w-3.5 rounded bg-chart-1/25" />
          Stellix Soft LLC
          <ChevronDown className="h-3 w-3" />
        </span>
        <span className="inline-flex w-56 items-center gap-1.5 rounded-md border border-border/60 px-2 py-1">
          <Search className="h-3 w-3" />
          Search anything…
          <kbd className="ml-auto rounded bg-muted px-1 text-[9px]">⌘K</kbd>
        </span>
        <span className="relative">
          <Bell className="h-3.5 w-3.5" />
          <span className="absolute -right-1 -top-1 flex h-2.5 w-2.5 items-center justify-center rounded-full bg-destructive text-[6px] text-white">
            1
          </span>
        </span>
        <span className="inline-flex items-center gap-1 rounded-md bg-primary px-2 py-1 text-[11px] font-medium text-primary-foreground">
          <Plus className="h-3 w-3" />
          Quick add
        </span>
      </div>
    </div>
  );
}

function IconRail() {
  return (
    <div className="flex w-10 shrink-0 flex-col items-center gap-1 border-r border-border/60 py-2">
      <div className="mb-1 flex h-6 w-6 items-center justify-center rounded-md bg-chart-1/20 text-[10px] font-semibold text-chart-1">
        N
      </div>
      {RAIL_ICONS.map((Icon, i) => (
        <div
          key={i}
          className={cn(
            "flex h-6 w-6 items-center justify-center rounded-md",
            i === 0 ? "bg-muted text-foreground" : "text-muted-foreground/70",
          )}
        >
          <Icon className="h-3.5 w-3.5" />
        </div>
      ))}
    </div>
  );
}

function Control({ icon: Icon, label }: { icon: LucideIcon; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-md border border-border/60 px-2 py-1 text-[11px] text-muted-foreground">
      <Icon className="h-3 w-3" />
      {label}
    </span>
  );
}

function Board() {
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-3 px-4 py-3">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="font-heading text-lg font-semibold tracking-tight">
            Overview
          </h3>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            Command board: live outreach, team scorecards, inbox leaders, and
            wall-ready ops pulse.
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1.5">
          <div className="flex items-center gap-1.5">
            <Control icon={Monitor} label="Wall mode" />
            <Control icon={LayoutGrid} label="Layout" />
            <Control icon={CalendarDays} label="Last 30 days" />
            <Control icon={Users} label="All owners" />
            <Control icon={Filter} label="Filter" />
          </div>
          <Control icon={Download} label="Export" />
        </div>
      </div>

      <div className="rounded-lg border border-border/50 bg-muted/20 px-3 py-2">
        <p className="text-[11px] font-medium">Director view</p>
        <p className="text-[10px] text-muted-foreground">
          Prioritise site companies, channel mix, and revenue concentration,
          then drill into any rep.
        </p>
      </div>

      <div className="grid grid-cols-6 gap-3">
        {KPIS.map((k) => (
          <KpiCard
            key={k.label}
            label={k.label}
            value={k.value}
            icon={k.icon}
            tone={k.tone}
            hint={<HintLine parts={k.hints} />}
          />
        ))}
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-12 gap-3">
        <div className="col-span-8 flex min-w-0 flex-col gap-3">
          <div className="grid grid-cols-2 gap-3">
            <EmailVolumeCard />
            <FollowupScheduleCard />
          </div>
          <TeamCommandCard />
        </div>
        <div className="col-span-4 flex min-h-0 min-w-0 flex-col">
          <LiveActivityCard />
        </div>
      </div>
    </div>
  );
}

/**
 * Below this, the UI stops being readable and becomes texture. Narrow screens
 * crop into the board instead of shrinking it further.
 */
const MIN_SCALE = 0.46;
const MIN_HEIGHT = 360;

/**
 * Renders the board at its native desktop width, then scales it to fit.
 * The app's own layout only resolves above the xl breakpoint, so letting it
 * reflow into a narrow container would show a layout the product never uses.
 */
function ScaledFrame({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<{ scale: number; height: number } | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const w = entry.contentRect.width;
      setBox({
        scale: Math.max(MIN_SCALE, w / DESIGN_WIDTH),
        height: Math.max((w * DESIGN_HEIGHT) / DESIGN_WIDTH, MIN_HEIGHT),
      });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      className="relative w-full overflow-hidden"
      style={
        box
          ? { height: box.height }
          : { aspectRatio: `${DESIGN_WIDTH} / ${DESIGN_HEIGHT}` }
      }
    >
      <div
        className="absolute left-0 top-0 origin-top-left"
        style={{
          width: DESIGN_WIDTH,
          height: DESIGN_HEIGHT,
          transform: `scale(${box?.scale ?? 0})`,
        }}
      >
        {children}
      </div>
    </div>
  );
}

export function ProductShot({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "overflow-hidden rounded-xl bg-background/85 ring-1 ring-white/10 backdrop-blur-xl",
        className,
      )}
    >
      <ScaledFrame>
        <div className="flex h-full flex-col bg-background">
          <TopBar />
          <div className="flex min-h-0 flex-1">
            <IconRail />
            <Board />
          </div>
        </div>
      </ScaledFrame>
    </div>
  );
}
