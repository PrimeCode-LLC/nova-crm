"use client";

import * as React from "react";
import Link from "next/link";
import {
  CalendarClock,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Plus,
  Sparkles,
} from "lucide-react";

import { PageBody, PageHeader } from "@/components/common/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { KpiCard } from "@/components/common/kpi-card";
import { UserChip } from "@/components/common/user-chip";
import { mockFollowups, getLeadById } from "@/lib/mock-data";
import { PRIORITY_TONE } from "@/lib/constants";
import { fmtDate, fmtRelative } from "@/lib/format";
import { cn } from "@/lib/utils";

function categorize(dueAt: string) {
  const d = new Date(dueAt);
  const now = Date.now();
  const diff = d.getTime() - now;
  const day = 86400_000;
  if (diff < 0) return "overdue";
  if (diff < day) return "today";
  if (diff < day * 7) return "thisWeek";
  return "later";
}

export default function FollowupsPage() {
  const open = mockFollowups.filter((f) => !f.completedAt);
  const done = mockFollowups.filter((f) => f.completedAt);

  const overdue = open.filter((f) => categorize(f.dueAt) === "overdue");
  const today = open.filter((f) => categorize(f.dueAt) === "today");
  const thisWeek = open.filter((f) => categorize(f.dueAt) === "thisWeek");
  const later = open.filter((f) => categorize(f.dueAt) === "later");

  return (
    <>
      <PageHeader
        title="Followups"
        description="Your tasks and reminders — including auto-generated idle warnings."
        actions={
          <Button size="sm">
            <Plus className="h-3.5 w-3.5" /> New followup
          </Button>
        }
      />
      <PageBody>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <KpiCard label="Overdue" value={overdue.length} icon={AlertTriangle} />
          <KpiCard label="Due today" value={today.length} icon={Clock} />
          <KpiCard label="This week" value={thisWeek.length} icon={CalendarClock} />
          <KpiCard label="Completed" value={done.length} icon={CheckCircle2} />
        </div>

        <Tabs defaultValue="open">
          <TabsList>
            <TabsTrigger value="open">
              Open
              <Badge variant="secondary" className="ml-1.5 h-4 px-1 text-[10px]">{open.length}</Badge>
            </TabsTrigger>
            <TabsTrigger value="completed">
              Completed
              <Badge variant="secondary" className="ml-1.5 h-4 px-1 text-[10px]">{done.length}</Badge>
            </TabsTrigger>
          </TabsList>

          <TabsContent value="open" className="mt-4 space-y-4">
            <FollowupGroup
              title="Overdue"
              description="Past due — highest priority."
              tone="rose"
              items={overdue}
              empty="Nothing overdue. Nice."
            />
            <FollowupGroup
              title="Due today"
              description="Let's knock these out today."
              tone="amber"
              items={today}
              empty="Nothing due today."
            />
            <FollowupGroup
              title="This week"
              description="Coming up in the next 7 days."
              tone="neutral"
              items={thisWeek}
              empty="No followups this week."
            />
            <FollowupGroup
              title="Later"
              description="Scheduled further out."
              tone="neutral"
              items={later}
              empty="Nothing scheduled further out."
            />
          </TabsContent>

          <TabsContent value="completed" className="mt-4">
            <Card>
              <CardContent className="p-0 divide-y">
                {done.map((f) => (
                  <div key={f.id} className="flex items-center gap-3 px-4 py-2 opacity-70">
                    <Checkbox checked disabled />
                    <span className="text-sm line-through truncate flex-1">{f.title}</span>
                    <span className="text-xs text-muted-foreground">{fmtRelative(f.completedAt)}</span>
                  </div>
                ))}
                {done.length === 0 && (
                  <div className="p-6 text-center text-sm text-muted-foreground">
                    Nothing completed yet.
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </PageBody>
    </>
  );
}

function FollowupGroup({
  title,
  description,
  tone,
  items,
  empty,
}: {
  title: string;
  description: string;
  tone: "rose" | "amber" | "neutral";
  items: typeof mockFollowups;
  empty: string;
}) {
  const toneRing =
    tone === "rose"
      ? "border-rose-500/30 bg-rose-500/5"
      : tone === "amber"
        ? "border-amber-500/30 bg-amber-500/5"
        : "";

  return (
    <Card className={cn(toneRing)}>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-sm">
              {title}
              <Badge variant="secondary" className="ml-2 h-4 px-1 text-[10px]">
                {items.length}
              </Badge>
            </CardTitle>
            <CardDescription className="text-xs">{description}</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground py-2">{empty}</p>
        ) : (
          <ul className="divide-y">
            {items.map((f) => {
              const lead = getLeadById(f.leadId ?? "");
              return (
                <li key={f.id} className="flex items-center gap-3 py-2.5">
                  <Checkbox />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium truncate">{f.title}</span>
                      <Badge className={cn("rounded-md border-transparent text-[10px]", PRIORITY_TONE[f.priority].className)}>
                        {PRIORITY_TONE[f.priority].label}
                      </Badge>
                      {f.auto && (
                        <Badge variant="outline" className="text-[10px] gap-1">
                          <Sparkles className="h-2.5 w-2.5" /> Auto
                        </Badge>
                      )}
                    </div>
                    {lead && (
                      <Link
                        href={`/leads/${lead.id}`}
                        className="text-xs text-muted-foreground hover:text-primary truncate block mt-0.5"
                      >
                        {lead.contactName} · {lead.companyName}
                      </Link>
                    )}
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <UserChip userId={f.ownerId} size="xs" nameOnly />
                    <span className="text-xs text-muted-foreground tabular-nums whitespace-nowrap">
                      {fmtDate(f.dueAt, "MMM d")} · {fmtRelative(f.dueAt)}
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
