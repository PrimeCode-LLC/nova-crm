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
import { mockActivityCounters, mockActivityRecords, mockUsers, mockProfiles } from "@/lib/mock-data";
import { CHANNELS, CHANNEL_FUNNELS } from "@/lib/constants";
import { fmtDate, fmtNumber, fmtRelative } from "@/lib/format";
import { ChannelChip } from "@/components/common/channel-chip";
import { UserChip } from "@/components/common/user-chip";
import { Plus, Save, Calendar } from "lucide-react";
import { toast } from "sonner";

export default function ActivityPage() {
  return (
    <>
      <PageHeader
        title="Activity"
        description="Daily counter rollups + per-record activities. Drives funnel diagnostics."
        actions={
          <Button size="sm">
            <Plus className="h-3.5 w-3.5" /> Log activity
          </Button>
        }
      />
      <PageBody>
        <Tabs defaultValue="rollup">
          <TabsList>
            <TabsTrigger value="rollup">Daily rollup</TabsTrigger>
            <TabsTrigger value="counters">Counters history</TabsTrigger>
            <TabsTrigger value="records">Per-record activities</TabsTrigger>
          </TabsList>

          <TabsContent value="rollup" className="mt-4">
            <DailyRollupForm />
          </TabsContent>

          <TabsContent value="counters" className="mt-4">
            <CountersTable />
          </TabsContent>

          <TabsContent value="records" className="mt-4">
            <RecordsTable />
          </TabsContent>
        </Tabs>
      </PageBody>
    </>
  );
}

function DailyRollupForm() {
  const [channel, setChannel] = React.useState<keyof typeof CHANNELS>("cold_email");
  const stages = CHANNEL_FUNNELS[channel];
  const [counters, setCounters] = React.useState<Record<string, string>>({});
  const [date, setDate] = React.useState(new Date().toISOString().slice(0, 10));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">Log today's activity</CardTitle>
        <CardDescription className="text-xs">
          Enter counts for your channel — takes ~30 seconds. Feeds into funnel analytics and scorecards.
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
            <Select value={channel} onValueChange={(v) => setChannel(v as keyof typeof CHANNELS)}>
              <SelectTrigger className="h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(CHANNELS).map(([k, v]) => (
                  <SelectItem key={k} value={k}>
                    {v.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Profile (optional)</Label>
            <Select>
              <SelectTrigger className="h-9">
                <SelectValue placeholder="None" />
              </SelectTrigger>
              <SelectContent>
                {mockProfiles
                  .filter((p) => p.channel === channel)
                  .map((p) => (
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
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            {stages.map((s) => (
              <div key={s.key} className="space-y-1.5">
                <Label className="text-xs">{s.label}</Label>
                <Input
                  type="number"
                  min={0}
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
          <Button variant="ghost" size="sm">Reset</Button>
          <Button size="sm" onClick={() => toast.success("Activity logged")}>
            <Save className="h-3.5 w-3.5" /> Save rollup
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function CountersTable() {
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
            {mockActivityCounters.map((a) => (
              <TableRow key={a.id}>
                <TableCell className="py-2 text-sm whitespace-nowrap">{fmtDate(a.date, "MMM d")}</TableCell>
                <TableCell className="py-2"><UserChip userId={a.userId} size="xs" /></TableCell>
                <TableCell className="py-2"><ChannelChip channel={a.channel} /></TableCell>
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
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function RecordsTable() {
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
            {mockActivityRecords.map((a) => (
              <TableRow key={a.id}>
                <TableCell className="py-2 text-xs font-mono text-muted-foreground">{a.type}</TableCell>
                <TableCell className="py-2"><UserChip userId={a.userId} size="xs" /></TableCell>
                <TableCell className="py-2"><ChannelChip channel={a.channel} /></TableCell>
                <TableCell className="py-2 text-sm">{a.summary ?? "—"}</TableCell>
                <TableCell className="py-2 text-sm">
                  {a.leadId ? (
                    <Link href={`/leads/${a.leadId}`} className="hover:text-primary text-primary/80">
                      {a.leadId}
                    </Link>
                  ) : (
                    "—"
                  )}
                </TableCell>
                <TableCell className="py-2 text-xs text-muted-foreground whitespace-nowrap">
                  {fmtRelative(a.occurredAt)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
