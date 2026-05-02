"use client";

import * as React from "react";
import { PageBody, PageHeader } from "@/components/common/page-header";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ChannelChip } from "@/components/common/channel-chip";
import { useWorkspace } from "@/components/providers/workspace-mode-provider";
import { fmtNumber, fmtPercent, fmtRelative } from "@/lib/format";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import Link from "next/link";

const STATUS_TONE: Record<string, string> = {
  draft: "bg-muted text-muted-foreground border-transparent",
  active: "bg-success/10 text-success border-success/20",
  paused: "bg-warning/10 text-warning border-warning/20",
  done: "bg-info/10 text-info border-info/20",
};

const STATUS_LABEL: Record<string, string> = {
  draft: "Draft",
  active: "Active",
  paused: "Paused",
  done: "Done",
};

export default function AdminCampaignsPage() {
  const { campaigns } = useWorkspace();
  return (
    <>
      <PageHeader
        title="Campaigns"
        description="Track all outreach campaigns across channels."
        actions={
          <Button size="sm" onClick={() => toast.info("New campaign (coming soon)")}>
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
                  <TableHead className="h-9">Name</TableHead>
                  <TableHead className="h-9">Channel</TableHead>
                  <TableHead className="h-9">Status</TableHead>
                  <TableHead className="h-9">External ref</TableHead>
                  <TableHead className="h-9">Started</TableHead>
                  <TableHead className="h-9 text-right">Sent</TableHead>
                  <TableHead className="h-9 text-right">Replied</TableHead>
                  <TableHead className="h-9 text-right">Meetings</TableHead>
                  <TableHead className="h-9 text-right">Closed</TableHead>
                  <TableHead className="h-9 text-right">Reply rate</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {campaigns.map((c) => {
                  const replyRate =
                    c.stats.sent > 0
                      ? (c.stats.replied / c.stats.sent) * 100
                      : c.stats.replied > 0
                        ? 100
                        : 0;
                  return (
                    <TableRow key={c.id}>
                      <TableCell className="py-2">
                        <Link
                          href="#"
                          className="text-sm font-medium hover:text-primary"
                        >
                          {c.name}
                        </Link>
                      </TableCell>
                      <TableCell className="py-2">
                        <ChannelChip channel={c.channel} />
                      </TableCell>
                      <TableCell className="py-2">
                        <Badge
                          variant="outline"
                          className={`text-[10px] capitalize ${STATUS_TONE[c.status]}`}
                        >
                          <span className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-current opacity-80" />
                          {STATUS_LABEL[c.status]}
                        </Badge>
                      </TableCell>
                      <TableCell className="py-2 text-xs font-mono text-muted-foreground">
                        {c.externalRef ?? "-"}
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
          <span className="tabular-nums font-medium text-foreground">
            {campaigns.length}
          </span>{" "}
          campaigns total ·{" "}
          <span className="tabular-nums font-medium text-foreground">
            {campaigns.filter((c) => c.status === "active").length}
          </span>{" "}
          active
        </div>
      </PageBody>
    </>
  );
}
