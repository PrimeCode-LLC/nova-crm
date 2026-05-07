"use client";

import * as React from "react";
import Link from "next/link";
import { PageBody, PageHeader } from "@/components/common/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ChannelChip } from "@/components/common/channel-chip";
import { useWorkspace } from "@/components/providers/workspace-mode-provider";
import { fmtNumber, fmtPercent, fmtRelative } from "@/lib/format";
import { campaignReplyRate, instantlyCampaignHref } from "@/lib/campaign-utils";
import { CHANNEL_LIST } from "@/lib/constants";
import { selectTriggerLabelByKey } from "@/lib/base-ui-select-label";
import type { Campaign, ChannelKey } from "@/lib/types";
import { ArrowUpDown, Check, Copy, ExternalLink, MoreHorizontal, Plus } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

const STATUS_TONE: Record<string, string> = {
  draft: "bg-muted text-muted-foreground border-transparent",
  active: "bg-success/10 text-success border-success/20",
  paused: "bg-warning/10 text-warning border-warning/20",
  done: "bg-info/10 text-info border-info/20",
};

const STATUS_LABEL: Record<Campaign["status"], string> = {
  draft: "Draft",
  active: "Active",
  paused: "Paused",
  done: "Done",
};

const STATUS_ORDER: Campaign["status"][] = ["draft", "active", "paused", "done"];

type SortKey =
  | "name"
  | "channel"
  | "status"
  | "externalRef"
  | "started"
  | "sent"
  | "replied"
  | "meetings"
  | "closed"
  | "replyRate";

function sortCampaigns(list: readonly Campaign[], key: SortKey, dir: 1 | -1): Campaign[] {
  const mult = dir;
  return [...list].sort((a, b) => {
    let cmp = 0;
    switch (key) {
      case "name":
        cmp = a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
        break;
      case "channel":
        cmp = a.channel.localeCompare(b.channel);
        break;
      case "status":
        cmp = a.status.localeCompare(b.status);
        break;
      case "externalRef":
        cmp = (a.externalRef ?? "\uffff").localeCompare(b.externalRef ?? "\uffff");
        break;
      case "started": {
        const ta = a.startedAt ? new Date(a.startedAt).getTime() : 0;
        const tb = b.startedAt ? new Date(b.startedAt).getTime() : 0;
        cmp = ta - tb;
        break;
      }
      case "sent":
        cmp = a.stats.sent - b.stats.sent;
        break;
      case "replied":
        cmp = a.stats.replied - b.stats.replied;
        break;
      case "meetings":
        cmp = a.stats.meetings - b.stats.meetings;
        break;
      case "closed":
        cmp = a.stats.closed - b.stats.closed;
        break;
      case "replyRate":
        cmp = campaignReplyRate(a) - campaignReplyRate(b);
        break;
      default:
        cmp = 0;
    }
    return cmp * mult;
  });
}

function SortableHead({
  label,
  sortKey,
  activeKey,
  dir,
  onSort,
  align = "left",
}: {
  label: string;
  sortKey: SortKey;
  activeKey: SortKey;
  dir: 1 | -1;
  onSort: (k: SortKey) => void;
  align?: "left" | "right";
}) {
  const active = activeKey === sortKey;
  return (
    <TableHead className={cn("h-9", align === "right" && "text-right")}>
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className={cn(
          "inline-flex items-center gap-1 font-medium hover:text-foreground",
          align === "right" ? "w-full justify-end" : "",
          active ? "text-foreground" : "text-muted-foreground",
        )}
      >
        {label}
        <ArrowUpDown
          className={cn("h-3 w-3 opacity-50", active && "opacity-100 text-primary")}
          aria-hidden
        />
        {active && (
          <span className="sr-only">{dir === 1 ? "sorted ascending" : "sorted descending"}</span>
        )}
      </button>
    </TableHead>
  );
}

export default function AdminCampaignsPage() {
  const { campaigns, updateCampaign, addCampaign } = useWorkspace();
  const [sortKey, setSortKey] = React.useState<SortKey>("name");
  const [sortDir, setSortDir] = React.useState<1 | -1>(1);
  const [newOpen, setNewOpen] = React.useState(false);
  const [newName, setNewName] = React.useState("");
  const [newChannel, setNewChannel] = React.useState<ChannelKey>("cold_email");
  const [newExternalRef, setNewExternalRef] = React.useState("");

  const sorted = React.useMemo(
    () => sortCampaigns(campaigns, sortKey, sortDir),
    [campaigns, sortKey, sortDir],
  );

  function onSort(k: SortKey) {
    if (k === sortKey) setSortDir((d) => (d === 1 ? -1 : 1));
    else {
      setSortKey(k);
      setSortDir(1);
    }
  }

  function openNew() {
    setNewName("");
    setNewChannel("cold_email");
    setNewExternalRef("");
    setNewOpen(true);
  }

  function submitNew(e: React.FormEvent) {
    e.preventDefault();
    const name = newName.trim();
    if (!name) {
      toast.error("Enter a campaign name.");
      return;
    }
    const id = `c-${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
    const ref = newExternalRef.trim();
    addCampaign({
      id,
      name,
      channel: newChannel,
      status: "draft",
      externalRef: ref || undefined,
      startedAt: new Date().toISOString(),
      stats: { sent: 0, replied: 0, meetings: 0, closed: 0 },
    });
    setNewOpen(false);
    toast.success("Campaign created", { description: name });
  }

  async function copyRef(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Copied to clipboard");
    } catch {
      toast.error("Could not copy");
    }
  }

  return (
    <>
      <PageHeader
        title="Campaigns"
        description="Track all outreach campaigns across channels."
        actions={
          <Button size="sm" onClick={openNew}>
            <Plus className="h-3.5 w-3.5" /> New campaign
          </Button>
        }
      />
      <PageBody>
        <div className="rounded-md border overflow-hidden">
          <div className="overflow-x-auto scrollbar-thin">
            <Table>
              <TableHeader className="bg-muted/30">
                <TableRow className="hover:bg-transparent">
                  <SortableHead label="Name" sortKey="name" activeKey={sortKey} dir={sortDir} onSort={onSort} />
                  <SortableHead label="Channel" sortKey="channel" activeKey={sortKey} dir={sortDir} onSort={onSort} />
                  <SortableHead label="Status" sortKey="status" activeKey={sortKey} dir={sortDir} onSort={onSort} />
                  <SortableHead
                    label="External ref"
                    sortKey="externalRef"
                    activeKey={sortKey}
                    dir={sortDir}
                    onSort={onSort}
                  />
                  <SortableHead label="Started" sortKey="started" activeKey={sortKey} dir={sortDir} onSort={onSort} />
                  <SortableHead label="Sent" sortKey="sent" activeKey={sortKey} dir={sortDir} onSort={onSort} align="right" />
                  <SortableHead
                    label="Replied"
                    sortKey="replied"
                    activeKey={sortKey}
                    dir={sortDir}
                    onSort={onSort}
                    align="right"
                  />
                  <SortableHead
                    label="Meetings"
                    sortKey="meetings"
                    activeKey={sortKey}
                    dir={sortDir}
                    onSort={onSort}
                    align="right"
                  />
                  <SortableHead
                    label="Closed"
                    sortKey="closed"
                    activeKey={sortKey}
                    dir={sortDir}
                    onSort={onSort}
                    align="right"
                  />
                  <SortableHead
                    label="Reply rate"
                    sortKey="replyRate"
                    activeKey={sortKey}
                    dir={sortDir}
                    onSort={onSort}
                    align="right"
                  />
                </TableRow>
              </TableHeader>
              <TableBody>
                {sorted.map((c) => {
                  const replyRate = campaignReplyRate(c);
                  const instantlyHref = instantlyCampaignHref(c.externalRef);
                  return (
                    <TableRow key={c.id}>
                      <TableCell className="py-2">
                        <Link
                          href={`/admin/campaigns/${c.id}`}
                          className="text-sm font-medium text-primary hover:underline"
                        >
                          {c.name}
                        </Link>
                      </TableCell>
                      <TableCell className="py-2">
                        <ChannelChip channel={c.channel} />
                      </TableCell>
                      <TableCell className="py-2">
                        <DropdownMenu>
                          <DropdownMenuTrigger
                            render={
                              <Button
                                variant="outline"
                                size="sm"
                                className={cn(
                                  "h-7 gap-1 px-2 text-[10px] font-medium capitalize",
                                  STATUS_TONE[c.status],
                                )}
                              >
                                <span className="mr-0.5 inline-block h-1.5 w-1.5 rounded-full bg-current opacity-80" />
                                {STATUS_LABEL[c.status]}
                              </Button>
                            }
                          />
                          <DropdownMenuContent align="start" className="w-44">
                            <p className="px-2 py-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                              Set status
                            </p>
                            {STATUS_ORDER.map((st) => (
                              <DropdownMenuItem
                                key={st}
                                onSelect={() => {
                                  updateCampaign(c.id, { status: st });
                                }}
                                className="gap-2"
                              >
                                {st === c.status && <Check className="h-3.5 w-3.5 text-primary" />}
                                {st !== c.status && <span className="w-3.5" />}
                                {STATUS_LABEL[st]}
                              </DropdownMenuItem>
                            ))}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                      <TableCell className="py-2">
                        {c.externalRef ? (
                          <DropdownMenu>
                            <DropdownMenuTrigger
                              render={
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-auto max-w-[200px] justify-start px-2 py-1 font-mono text-xs text-muted-foreground hover:text-foreground"
                                >
                                  <span className="truncate">{c.externalRef}</span>
                                  <MoreHorizontal className="h-3 w-3 shrink-0 opacity-60" />
                                </Button>
                              }
                            />
                            <DropdownMenuContent align="start">
                              <DropdownMenuItem onSelect={() => void copyRef(c.externalRef!)}>
                                <Copy className="h-3.5 w-3.5" /> Copy reference
                              </DropdownMenuItem>
                              {instantlyHref ? (
                                <DropdownMenuItem
                                  onSelect={() => {
                                    window.open(instantlyHref, "_blank", "noopener,noreferrer");
                                  }}
                                >
                                  <ExternalLink className="h-3.5 w-3.5" /> Open in Instantly
                                </DropdownMenuItem>
                              ) : null}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        ) : (
                          <span className="text-xs font-mono text-muted-foreground">-</span>
                        )}
                      </TableCell>
                      <TableCell className="py-2 text-xs text-muted-foreground whitespace-nowrap">
                        {c.startedAt ? fmtRelative(c.startedAt) : "-"}
                      </TableCell>
                      <TableCell className="py-2 text-right tabular-nums text-sm">
                        {fmtNumber(c.stats.sent)}
                      </TableCell>
                      <TableCell className="py-2 text-right tabular-nums text-sm">
                        {fmtNumber(c.stats.replied)}
                      </TableCell>
                      <TableCell className="py-2 text-right tabular-nums text-sm">
                        {fmtNumber(c.stats.meetings)}
                      </TableCell>
                      <TableCell className="py-2 text-right tabular-nums text-sm">
                        {fmtNumber(c.stats.closed)}
                      </TableCell>
                      <TableCell className="py-2 text-right tabular-nums text-sm">
                        <span
                          className={
                            replyRate >= 5
                              ? "text-success"
                              : replyRate >= 2
                                ? "text-warning"
                                : "text-muted-foreground"
                          }
                        >
                          {fmtPercent(replyRate, 1)}
                        </span>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </div>

        <div className="text-xs text-muted-foreground">
          <span className="tabular-nums font-medium text-foreground">{campaigns.length}</span> campaigns total ·{" "}
          <span className="tabular-nums font-medium text-foreground">
            {campaigns.filter((c) => c.status === "active").length}
          </span>{" "}
          active
        </div>
      </PageBody>

      <Dialog open={newOpen} onOpenChange={setNewOpen}>
        <DialogContent className="max-w-md" showCloseButton>
          <form onSubmit={submitNew}>
            <DialogHeader>
              <DialogTitle>New campaign</DialogTitle>
              <DialogDescription>Add a campaign to this workspace. You can change status and sync details later.</DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-2">
              <div className="grid gap-2">
                <Label htmlFor="camp-name">Name</Label>
                <Input
                  id="camp-name"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="e.g. Enterprise Q3 outbound"
                  autoFocus
                />
              </div>
              <div className="grid gap-2">
                <Label>Channel</Label>
                <Select value={newChannel} onValueChange={(v) => setNewChannel((v ?? "cold_email") as ChannelKey)}>
                  <SelectTrigger className="h-9 w-full min-w-0">
                    <SelectValue placeholder="Channel">
                      {selectTriggerLabelByKey(newChannel, CHANNEL_LIST) ?? undefined}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {CHANNEL_LIST.map((ch) => (
                      <SelectItem key={ch.key} value={ch.key}>
                        {ch.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="camp-ref">External reference (optional)</Label>
                <Input
                  id="camp-ref"
                  value={newExternalRef}
                  onChange={(e) => setNewExternalRef(e.target.value)}
                  placeholder="e.g. instantly:camp_1234"
                  className="font-mono text-xs"
                />
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setNewOpen(false)}>
                Cancel
              </Button>
              <Button type="submit">Create campaign</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
