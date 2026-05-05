"use client";

import * as React from "react";
import Link from "next/link";
import { PageBody, PageHeader } from "@/components/common/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useWorkspace } from "@/components/providers/workspace-mode-provider";
import { WorkspaceEmptyHint } from "@/components/common/workspace-empty-hint";
import { CHANNEL_FUNNELS, CHANNEL_LIST } from "@/lib/constants";
import { useChannelAdminStore } from "@/stores/channel-admin-store";
import type { OrganizationCustomChannelRow } from "@/lib/types";
import { fmtDate, fmtNumber, fmtRelative } from "@/lib/format";
import { ChannelChip } from "@/components/common/channel-chip";
import { UserChip } from "@/components/common/user-chip";
import { Plus, Save, Calendar } from "lucide-react";
import { toast } from "sonner";
import { useLocalActivityRollups } from "@/hooks/use-local-activity-rollups";
import { mergeActivityCounters } from "@/lib/activity-local-rollups";
import type { ActivityCounterRow, ChannelKey } from "@/lib/types";

const PROFILE_NONE = "__none__";

type ActivityTab = "rollup" | "counters" | "records";

function buildRollupChannelOptions(customChannels: { id: string; name: string }[]) {
  return [
    ...CHANNEL_LIST.map((c) => ({ key: c.key, label: c.label })),
    ...customChannels
      .map((c) => ({ key: `custom_${c.id}`, label: c.name.trim() }))
      .filter((c) => c.label.length > 0),
  ];
}

function rollupFunnelStages(
  channel: string,
  customChannels: OrganizationCustomChannelRow[],
): { key: string; label: string }[] {
  if (channel.startsWith("custom_")) {
    const id = channel.slice("custom_".length);
    return customChannels.find((c) => c.id === id)?.stages ?? [];
  }
  return CHANNEL_FUNNELS[channel as ChannelKey] ?? [];
}

export default function ActivityPage() {
  const { isDemo, activityCounters, activityRecords, currentUserId } = useWorkspace();
  const { localRollups, upsertLocalRollup } = useLocalActivityRollups();
  const mergedCounters = React.useMemo(
    () => mergeActivityCounters(activityCounters, localRollups),
    [activityCounters, localRollups],
  );
  const sortedCounters = React.useMemo(
    () => [...mergedCounters].sort((a, b) => b.date.localeCompare(a.date)),
    [mergedCounters],
  );

  const workspaceEmpty = !isDemo && activityCounters.length === 0 && activityRecords.length === 0;

  const [tab, setTab] = React.useState<ActivityTab>("rollup");
  const rollupAnchorRef = React.useRef<HTMLDivElement>(null);

  const goToRollupForm = React.useCallback(() => {
    setTab("rollup");
    requestAnimationFrame(() => {
      rollupAnchorRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      const first = rollupAnchorRef.current?.querySelector<HTMLInputElement>(
        'input[type="number"], input[type="date"]',
      );
      first?.focus();
    });
  }, []);

  return (
    <>
      <PageHeader
        title="Activity"
        description="Daily counter rollups + per-record activities. Drives funnel diagnostics."
        actions={
          <Button type="button" size="sm" onClick={goToRollupForm}>
            <Plus className="h-3.5 w-3.5" /> Log activity
          </Button>
        }
      />
      <PageBody>
        {workspaceEmpty && (
          <div className="mb-4">
            <WorkspaceEmptyHint title="No activity history yet" />
          </div>
        )}
        <Tabs value={tab} onValueChange={(v) => setTab(v as ActivityTab)}>
          <TabsList>
            <TabsTrigger value="rollup">Daily rollup</TabsTrigger>
            <TabsTrigger value="counters">Counters history</TabsTrigger>
            <TabsTrigger value="records">Per-record activities</TabsTrigger>
          </TabsList>

          <TabsContent value="rollup" className="mt-4">
            <div ref={rollupAnchorRef} id="activity-daily-rollup">
              <DailyRollupForm
                currentUserId={currentUserId || "local-user"}
                onSaved={() => {
                  setTab("counters");
                  toast.success("Rollup saved", {
                    description: "Shown in Counters history and included in dashboard funnel totals this session.",
                  });
                }}
                upsertLocalRollup={upsertLocalRollup}
              />
            </div>
          </TabsContent>

          <TabsContent value="counters" className="mt-4">
            <CountersTable rows={sortedCounters} />
          </TabsContent>

          <TabsContent value="records" className="mt-4">
            <RecordsTable />
          </TabsContent>
        </Tabs>
      </PageBody>
    </>
  );
}

function DailyRollupForm({
  currentUserId,
  onSaved,
  upsertLocalRollup,
}: {
  currentUserId: string;
  onSaved: () => void;
  upsertLocalRollup: (row: ActivityCounterRow) => void;
}) {
  const { profiles } = useWorkspace();
  const customChannels = useChannelAdminStore((s) => s.customChannels);
  const channelOptions = React.useMemo(
    () => buildRollupChannelOptions(customChannels),
    [customChannels],
  );
  const [channel, setChannel] = React.useState<string>("cold_email");
  const channelSelectLabel = React.useMemo(() => {
    const fromList = channelOptions.find((o) => o.key === channel)?.label;
    if (fromList) return fromList;
    if (channel.startsWith("custom_")) {
      const id = channel.slice("custom_".length);
      const row = customChannels.find((c) => c.id === id);
      if (row?.name.trim()) return row.name.trim();
    }
    return channel;
  }, [channel, channelOptions, customChannels]);
  const stages = React.useMemo(
    () => rollupFunnelStages(channel, customChannels),
    [channel, customChannels],
  );
  const [counters, setCounters] = React.useState<Record<string, string>>({});
  const [date, setDate] = React.useState(() => new Date().toISOString().slice(0, 10));
  const [profileId, setProfileId] = React.useState<string | undefined>(undefined);

  React.useEffect(() => {
    if (stages.length === 0) {
      setChannel("cold_email");
    }
  }, [stages.length, channel]);

  React.useEffect(() => {
    setCounters({});
    setProfileId(undefined);
  }, [channel]);

  function resetForm() {
    setChannel("cold_email");
    setCounters({});
    setDate(new Date().toISOString().slice(0, 10));
    setProfileId(undefined);
  }

  function saveRollup() {
    const numericCounters: Record<string, number> = {};
    for (const s of stages) {
      const raw = counters[s.key];
      if (raw === undefined || raw === "") continue;
      const n = Number(raw);
      if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n)) {
        toast.error("Invalid counter", { description: `Use whole numbers ≥ 0 for ${s.label}.` });
        return;
      }
      if (n > 0) numericCounters[s.key] = n;
    }
    if (Object.keys(numericCounters).length === 0) {
      toast.error("Add at least one non-zero count", { description: "Otherwise there is nothing to save." });
      return;
    }

    const row: ActivityCounterRow = {
      id: `local-ac-${Date.now()}`,
      userId: currentUserId,
      channel: channel as ChannelKey,
      profileId: profileId || undefined,
      date: `${date}T12:00:00.000Z`,
      counters: numericCounters,
    };
    upsertLocalRollup(row);
    setCounters({});
    onSaved();
  }

  const profileOptions = profiles.filter((p) => p.channel === channel);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">Log today's activity</CardTitle>
        <CardDescription className="text-xs">
          Enter counts for your channel (~30 seconds). Feeds into funnel analytics and scorecards.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="space-y-1.5">
            <Label className="text-xs">Date</Label>
            <div className="relative">
              <Calendar className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="pl-8 h-9"
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Channel</Label>
            <Select
              value={channel}
              onValueChange={(v) => {
                if (v) setChannel(v);
              }}
            >
              <SelectTrigger className="h-9">
                <SelectValue placeholder="Channel">{channelSelectLabel}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {channelOptions.map((opt) => (
                  <SelectItem key={opt.key} value={opt.key}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Profile (optional)</Label>
            <Select
              value={profileId ?? PROFILE_NONE}
              onValueChange={(v) =>
                setProfileId(!v || v === PROFILE_NONE ? undefined : v)
              }
            >
              <SelectTrigger className="h-9">
                <SelectValue placeholder="None" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={PROFILE_NONE}>None</SelectItem>
                {profileOptions.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="rounded-md border p-3 bg-muted/10">
          <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-3">
            Funnel counters
          </div>
          {stages.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No funnel stages for this channel. Configure stages under Admin → Channels, or pick another channel.
            </p>
          ) : null}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            {stages.map((s) => (
              <div key={s.key} className="space-y-1.5">
                <Label className="text-xs">{s.label}</Label>
                <Input
                  type="number"
                  min={0}
                  step={1}
                  placeholder="0"
                  value={counters[s.key] ?? ""}
                  onChange={(e) => setCounters({ ...counters, [s.key]: e.target.value })}
                  className="h-9 tabular-nums"
                />
              </div>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-2 justify-end">
          <Button type="button" variant="ghost" size="sm" onClick={resetForm}>
            Reset
          </Button>
          <Button type="button" size="sm" onClick={saveRollup}>
            <Save className="h-3.5 w-3.5" /> Save rollup
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function CountersTable({ rows }: { rows: ActivityCounterRow[] }) {
  return (
    <Card>
      <CardContent className="p-0">
        <Table>
          <TableHeader className="bg-muted/30">
            <TableRow className="hover:bg-transparent">
              <TableHead className="h-9">Date</TableHead>
              <TableHead className="h-9">Person</TableHead>
              <TableHead className="h-9">Channel</TableHead>
              <TableHead className="h-9">Counters</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="py-8 text-center text-sm text-muted-foreground">
                  No counter rollups yet. Use Daily rollup to add your first entry.
                </TableCell>
              </TableRow>
            ) : (
              rows.map((a) => (
                <TableRow key={a.id}>
                  <TableCell className="py-2 text-sm whitespace-nowrap">{fmtDate(a.date, "MMM d")}</TableCell>
                  <TableCell className="py-2">
                    <UserChip userId={a.userId} size="xs" />
                  </TableCell>
                  <TableCell className="py-2">
                    <ChannelChip channel={a.channel} />
                  </TableCell>
                  <TableCell className="py-2 text-xs tabular-nums">
                    <div className="flex flex-wrap gap-x-4 gap-y-0.5">
                      {Object.entries(a.counters).map(([k, v]) => (
                        <span key={k}>
                          <span className="text-muted-foreground">{k.replace(/_/g, " ")}</span>:{" "}
                          <span className="font-semibold">{fmtNumber(v)}</span>
                        </span>
                      ))}
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function RecordsTable() {
  const { activityRecords, getLeadById } = useWorkspace();
  return (
    <Card>
      <CardContent className="p-0">
        <Table>
          <TableHeader className="bg-muted/30">
            <TableRow className="hover:bg-transparent">
              <TableHead className="h-9">Type</TableHead>
              <TableHead className="h-9">Person</TableHead>
              <TableHead className="h-9">Channel</TableHead>
              <TableHead className="h-9">Summary</TableHead>
              <TableHead className="h-9">Lead</TableHead>
              <TableHead className="h-9">When</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {activityRecords.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="py-8 text-center text-sm text-muted-foreground">
                  No per-record activities yet.
                </TableCell>
              </TableRow>
            ) : (
              activityRecords.map((a) => (
                <TableRow key={a.id}>
                  <TableCell className="py-2 text-xs font-mono text-muted-foreground">{a.type}</TableCell>
                  <TableCell className="py-2">
                    <UserChip userId={a.userId} size="xs" />
                  </TableCell>
                  <TableCell className="py-2">
                    <ChannelChip channel={a.channel} />
                  </TableCell>
                  <TableCell className="py-2 text-sm">{a.summary ?? "-"}</TableCell>
                  <TableCell className="py-2 text-sm">
                    {a.leadId ? (
                      <Link href={`/leads/${a.leadId}`} className="hover:text-primary text-primary/80">
                        {getLeadById(a.leadId)?.contactName ?? a.leadId}
                      </Link>
                    ) : (
                      "-"
                    )}
                  </TableCell>
                  <TableCell className="py-2 text-xs text-muted-foreground whitespace-nowrap">
                    {fmtRelative(a.occurredAt)}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
