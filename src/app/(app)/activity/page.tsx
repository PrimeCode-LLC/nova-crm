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
import type { ActivityRecord, OrganizationCustomChannelRow, User } from "@/lib/types";
import { viewerHasElevatedWorkspaceRole } from "@/lib/viewer-elevated";
import { fmtDate, fmtNumber, fmtRelative } from "@/lib/format";
import { ChannelChip } from "@/components/common/channel-chip";
import { UserChip } from "@/components/common/user-chip";
import { Plus, Save, Calendar, Filter, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useLocalActivityRollups } from "@/hooks/use-local-activity-rollups";
import { mergeActivityCounters } from "@/lib/activity-local-rollups";
import type { ActivityCounterRow, ChannelKey } from "@/lib/types";
import { getFirebaseDb } from "@/lib/firebase/client";
import { isFirebaseWebConfigured } from "@/lib/firebase/config";
import {
  persistActivityCounterCreate,
  persistActivityCounterDelete,
  persistActivityRecordDelete,
} from "@/lib/firestore/persist-workspace-entities-client";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

const PROFILE_NONE = "__none__";
const FILTER_ALL = "__all__";

type ActivityTab = "counters" | "records";

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

function userByIdMap(users: readonly User[]): Map<string, User> {
  const m = new Map<string, User>();
  for (const u of users) m.set(u.id, u);
  return m;
}

export default function ActivityPage() {
  const {
    mode,
    isDemo,
    organizationId,
    activityCounters,
    activityRecords,
    currentUserId,
    users,
    departments,
  } = useWorkspace();
  const customChannels = useChannelAdminStore((s) => s.customChannels);
  const { localRollups, upsertLocalRollup, removeLocalRollupById } = useLocalActivityRollups();

  const persistRollupToFirestore = React.useCallback(
    async (row: ActivityCounterRow) => {
      if (!organizationId) {
        toast.error("Missing organization", { description: "Try reloading the page." });
        throw new Error("organizationId");
      }
      if (!isFirebaseWebConfigured()) {
        toast.error("Firebase is not configured", { description: "Cannot save to the cloud." });
        throw new Error("firebase");
      }
      const db = getFirebaseDb();
      await persistActivityCounterCreate(db, organizationId, row);
    },
    [organizationId],
  );

  const channelLabelByKey = React.useMemo(() => {
    const m = new Map<string, string>();
    for (const c of CHANNEL_LIST) m.set(c.key, c.label);
    for (const c of customChannels) {
      const id = `custom_${c.id}`;
      const name = c.name.trim();
      if (name) m.set(id, name);
    }
    return m;
  }, [customChannels]);
  const mergedCounters = React.useMemo(
    () => mergeActivityCounters(activityCounters, localRollups),
    [activityCounters, localRollups],
  );
  const sortedCounters = React.useMemo(
    () => [...mergedCounters].sort((a, b) => b.date.localeCompare(a.date)),
    [mergedCounters],
  );

  const workspaceEmpty = !isDemo && activityCounters.length === 0 && activityRecords.length === 0;

  const [tab, setTab] = React.useState<ActivityTab>("counters");
  const formTopRef = React.useRef<HTMLDivElement>(null);

  const [personFilter, setPersonFilter] = React.useState(FILTER_ALL);
  const [departmentFilter, setDepartmentFilter] = React.useState(FILTER_ALL);
  const [channelFilter, setChannelFilter] = React.useState(FILTER_ALL);

  const userMap = React.useMemo(() => userByIdMap(users), [users]);

  const actorUserIds = React.useMemo(() => {
    const ids = new Set<string>();
    for (const r of sortedCounters) ids.add(r.userId);
    for (const r of activityRecords) ids.add(r.userId);
    return ids;
  }, [sortedCounters, activityRecords]);

  const distinctActorCount = actorUserIds.size;

  const distinctDeptIds = React.useMemo(() => {
    const d = new Set<string>();
    for (const uid of actorUserIds) {
      const dept = userMap.get(uid)?.departmentId;
      if (dept) d.add(dept);
    }
    return d;
  }, [actorUserIds, userMap]);

  const distinctChannels = React.useMemo(() => {
    const c = new Set<string>();
    for (const r of sortedCounters) c.add(r.channel);
    for (const r of activityRecords) c.add(r.channel);
    return c;
  }, [sortedCounters, activityRecords]);

  const filteredCounters = React.useMemo(() => {
    return sortedCounters.filter((row) => {
      if (personFilter !== FILTER_ALL && row.userId !== personFilter) return false;
      if (departmentFilter !== FILTER_ALL) {
        const uidDept = userMap.get(row.userId)?.departmentId;
        if (uidDept !== departmentFilter) return false;
      }
      if (channelFilter !== FILTER_ALL && row.channel !== channelFilter) return false;
      return true;
    });
  }, [sortedCounters, personFilter, departmentFilter, channelFilter, userMap]);

  const filteredRecords = React.useMemo(() => {
    return activityRecords.filter((row) => {
      if (personFilter !== FILTER_ALL && row.userId !== personFilter) return false;
      if (departmentFilter !== FILTER_ALL) {
        const uidDept = userMap.get(row.userId)?.departmentId;
        if (uidDept !== departmentFilter) return false;
      }
      if (channelFilter !== FILTER_ALL && row.channel !== channelFilter) return false;
      return true;
    });
  }, [activityRecords, personFilter, departmentFilter, channelFilter, userMap]);

  const goToLogForm = React.useCallback(() => {
    requestAnimationFrame(() => {
      formTopRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      const first = formTopRef.current?.querySelector<HTMLInputElement>(
        'input[type="number"], input[type="date"]',
      );
      first?.focus();
    });
  }, []);

  const deptName = React.useCallback(
    (id: string) => departments.find((d) => d.id === id)?.name ?? id,
    [departments],
  );

  const showPersonFilter = distinctActorCount > 1;
  const showDeptFilter = distinctDeptIds.size > 1;
  const showChannelFilter = distinctChannels.size > 1;

  const currentMember = React.useMemo(
    () => users.find((u) => u.id === currentUserId),
    [users, currentUserId],
  );
  const canDeleteAnyActivity = viewerHasElevatedWorkspaceRole(currentMember);

  const [deleteTarget, setDeleteTarget] = React.useState<
    | { kind: "counter"; row: ActivityCounterRow }
    | { kind: "record"; record: ActivityRecord }
    | null
  >(null);

  const canDeleteCounterRow = React.useCallback(
    (row: ActivityCounterRow) => {
      if (!canDeleteAnyActivity) return false;
      if (mode === "live" && !isDemo) return true;
      return row.id.startsWith("local-ac");
    },
    [canDeleteAnyActivity, mode, isDemo],
  );

  const canDeleteActivityRecords = canDeleteAnyActivity && mode === "live" && !isDemo;

  const confirmDeleteActivity = React.useCallback(async () => {
    if (!deleteTarget) return;
    try {
      if (deleteTarget.kind === "counter") {
        const row = deleteTarget.row;
        if (row.id.startsWith("local-ac")) {
          removeLocalRollupById(row.id);
        } else {
          if (!isFirebaseWebConfigured()) {
            throw new Error("Firebase is not configured");
          }
          const db = getFirebaseDb();
          await persistActivityCounterDelete(db, row.id);
        }
        toast.success("Rollup removed");
      } else {
        if (!isFirebaseWebConfigured()) {
          throw new Error("Firebase is not configured");
        }
        const db = getFirebaseDb();
        await persistActivityRecordDelete(db, deleteTarget.record.id);
        toast.success("Activity record removed");
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error("Could not delete", { description: msg });
    }
    setDeleteTarget(null);
  }, [deleteTarget, removeLocalRollupById]);

  return (
    <>
      <PageHeader
        title="Activity"
        description="Daily counter rollups + per-record activities. Drives funnel diagnostics."
        actions={
          <Button type="button" size="sm" onClick={goToLogForm}>
            <Plus className="h-3.5 w-3.5" /> Log activity
          </Button>
        }
      />
      <PageBody>
        <div ref={formTopRef} id="activity-log-form" className="mb-6">
          <DailyRollupForm
            currentUserId={currentUserId || "local-user"}
            onPersistLive={
              mode === "live" && !isDemo && organizationId ? persistRollupToFirestore : undefined
            }
            onSaved={() => {
              setTab("counters");
              toast.success("Rollup saved", {
                description:
                  mode === "live" && !isDemo
                    ? "Saved to your workspace in Firebase. It appears for you and your leadership based on visibility rules."
                    : "Shown in Counters history and included in dashboard funnel totals this session.",
              });
            }}
            upsertLocalRollup={upsertLocalRollup}
          />
        </div>

        {workspaceEmpty && (
          <div className="mb-4">
            <WorkspaceEmptyHint title="No activity history yet" />
          </div>
        )}

        {(showPersonFilter || showDeptFilter || showChannelFilter) && (
          <Card className="mb-4">
            <CardHeader className="py-3 px-4">
              <CardTitle className="text-sm flex items-center gap-2">
                <Filter className="h-3.5 w-3.5 text-muted-foreground" />
                History filters
              </CardTitle>
              <CardDescription className="text-xs">
                Narrow counters and per-record rows. Filters apply to both tabs.
              </CardDescription>
            </CardHeader>
            <CardContent className="pt-0 px-4 pb-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {showPersonFilter ? (
                  <div className="space-y-1.5">
                    <Label className="text-xs">Person</Label>
                    <Select value={personFilter} onValueChange={(v) => setPersonFilter(v || FILTER_ALL)}>
                      <SelectTrigger className="h-9">
                        <SelectValue placeholder="All people" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={FILTER_ALL}>All people</SelectItem>
                        {[...actorUserIds].sort().map((uid) => (
                          <SelectItem key={uid} value={uid}>
                            {userMap.get(uid)?.displayName ?? uid}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ) : null}
                {showDeptFilter ? (
                  <div className="space-y-1.5">
                    <Label className="text-xs">Department</Label>
                    <Select
                      value={departmentFilter}
                      onValueChange={(v) => setDepartmentFilter(v || FILTER_ALL)}
                    >
                      <SelectTrigger className="h-9">
                        <SelectValue placeholder="All departments" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={FILTER_ALL}>All departments</SelectItem>
                        {[...distinctDeptIds].sort().map((id) => (
                          <SelectItem key={id} value={id}>
                            {deptName(id)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ) : null}
                {showChannelFilter ? (
                  <div className="space-y-1.5">
                    <Label className="text-xs">Channel</Label>
                    <Select value={channelFilter} onValueChange={(v) => setChannelFilter(v || FILTER_ALL)}>
                      <SelectTrigger className="h-9">
                        <SelectValue placeholder="All channels" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={FILTER_ALL}>All channels</SelectItem>
                        {[...distinctChannels].sort().map((ch) => (
                          <SelectItem key={ch} value={ch}>
                            {channelLabelByKey.get(ch) ?? ch.replace(/_/g, " ")}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ) : null}
              </div>
            </CardContent>
          </Card>
        )}

        <Tabs value={tab} onValueChange={(v) => setTab(v as ActivityTab)}>
          <TabsList>
            <TabsTrigger value="counters">Counters history</TabsTrigger>
            <TabsTrigger value="records">Per-record activities</TabsTrigger>
          </TabsList>

          <TabsContent value="counters" className="mt-4">
            <CountersTable
              rows={filteredCounters}
              canDeleteRow={canDeleteCounterRow}
              onRequestDelete={(row) => setDeleteTarget({ kind: "counter", row })}
            />
          </TabsContent>

          <TabsContent value="records" className="mt-4">
            <RecordsTable
              records={filteredRecords}
              canDelete={canDeleteActivityRecords}
              onRequestDelete={(record) => setDeleteTarget({ kind: "record", record })}
            />
          </TabsContent>
        </Tabs>

        <AlertDialog open={deleteTarget != null} onOpenChange={(o) => !o && setDeleteTarget(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                {deleteTarget?.kind === "counter" ? "Delete this rollup?" : "Delete this activity record?"}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {deleteTarget?.kind === "counter"
                  ? "This removes the saved counter row for that person, date, and channel. Dashboard totals will update after the next sync."
                  : "This permanently removes the per-record activity entry."}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction variant="destructive" onClick={() => void confirmDeleteActivity()}>
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </PageBody>
    </>
  );
}

function DailyRollupForm({
  currentUserId,
  onPersistLive,
  onSaved,
  upsertLocalRollup,
}: {
  currentUserId: string;
  /** When set (live CRM), rollup is written to Firestore instead of session-only storage. */
  onPersistLive?: (row: ActivityCounterRow) => Promise<void>;
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

  async function saveRollup() {
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
      toast.error("Add at least one non-zero count", {
        description: "Otherwise there is nothing to save.",
      });
      return;
    }

    const rowId = onPersistLive
      ? typeof crypto !== "undefined" && "randomUUID" in crypto
        ? `ac-${crypto.randomUUID()}`
        : `ac-${Date.now()}`
      : `local-ac-${Date.now()}`;
    const row: ActivityCounterRow = {
      id: rowId,
      userId: currentUserId,
      channel: channel as ChannelKey,
      profileId: profileId || undefined,
      date: `${date}T12:00:00.000Z`,
      counters: numericCounters,
    };
    try {
      if (onPersistLive) {
        await onPersistLive(row);
      } else {
        upsertLocalRollup(row);
      }
      setCounters({});
      onSaved();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error("Could not save rollup", { description: msg });
    }
  }

  const profileOptions = profiles.filter((p) => p.channel === channel);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">Log today&apos;s activity</CardTitle>
        <CardDescription className="text-xs">
          Enter counts for your channel (~30 seconds). Feeds into funnel analytics and scorecards. Managers and
          workspace owners see rollups from their team automatically.
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
              onValueChange={(v) => setProfileId(!v || v === PROFILE_NONE ? undefined : v)}
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

function CountersTable({
  rows,
  canDeleteRow,
  onRequestDelete,
}: {
  rows: ActivityCounterRow[];
  canDeleteRow: (row: ActivityCounterRow) => boolean;
  onRequestDelete: (row: ActivityCounterRow) => void;
}) {
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
              <TableHead className="h-9 w-12 text-right sr-only">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="py-8 text-center text-sm text-muted-foreground">
                  No counter rollups match your filters. Adjust filters or log a new rollup above.
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
                  <TableCell className="py-2 text-right align-middle">
                    {canDeleteRow(a) ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-muted-foreground hover:text-destructive"
                        aria-label="Delete rollup"
                        onClick={() => onRequestDelete(a)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    ) : null}
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

function RecordsTable({
  records,
  canDelete,
  onRequestDelete,
}: {
  records: ActivityRecord[];
  canDelete: boolean;
  onRequestDelete: (record: ActivityRecord) => void;
}) {
  const { getLeadById } = useWorkspace();
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
              <TableHead className="h-9 w-12 text-right sr-only">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {records.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="py-8 text-center text-sm text-muted-foreground">
                  No per-record activities match your filters.
                </TableCell>
              </TableRow>
            ) : (
              records.map((a) => (
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
                  <TableCell className="py-2 text-right align-middle">
                    {canDelete ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-muted-foreground hover:text-destructive"
                        aria-label="Delete activity record"
                        onClick={() => onRequestDelete(a)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    ) : null}
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
