"use client";

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { mockUsers, mockLeads, mockDeals } from "@/lib/mock-data";
import { fmtNumber, fmtPercent, fmtCurrency } from "@/lib/format";
import { ROLES } from "@/lib/constants";
import { UserChip } from "@/components/common/user-chip";
import { Badge } from "@/components/ui/badge";

export function PersonScorecard() {
  const rows = mockUsers
    .filter((u) => u.roleId !== "director" && u.status === "active")
    .map((u) => {
      const leads = mockLeads.filter((l) => l.ownerId === u.id);
      const replied = leads.filter((l) =>
        ["replied", "qualified", "discovery", "proposal", "negotiation", "won"].includes(l.stage),
      ).length;
      const won = leads.filter((l) => l.stage === "won").length;
      const deals = mockDeals.filter((d) => d.ownerId === u.id && d.stage === "won");
      const pipeline = mockDeals
        .filter((d) => d.ownerId === u.id && !["won", "lost"].includes(d.stage))
        .reduce((s, d) => s + d.value, 0);
      const closedValue = deals.reduce((s, d) => s + d.value, 0);

      return {
        user: u,
        leads: leads.length,
        replyRate: leads.length > 0 ? (replied / leads.length) * 100 : 0,
        winRate: leads.length > 0 ? (won / leads.length) * 100 : 0,
        pipeline,
        closedValue,
      };
    })
    .sort((a, b) => b.closedValue - a.closedValue);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-semibold">Team scorecards</CardTitle>
        <CardDescription className="text-xs">
          Per-person funnel performance · last 30 days
        </CardDescription>
      </CardHeader>
      <CardContent className="pt-0">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="h-8">Person</TableHead>
              <TableHead className="h-8">Role</TableHead>
              <TableHead className="h-8 text-right">Leads</TableHead>
              <TableHead className="h-8 text-right">Reply</TableHead>
              <TableHead className="h-8 text-right">Win</TableHead>
              <TableHead className="h-8 text-right">Pipeline</TableHead>
              <TableHead className="h-8 text-right">Closed</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.user.id}>
                <TableCell className="py-2">
                  <UserChip userId={r.user.id} />
                </TableCell>
                <TableCell className="py-2">
                  <Badge variant="outline" className="text-[10px] font-normal">
                    {ROLES[r.user.roleId].label}
                  </Badge>
                </TableCell>
                <TableCell className="py-2 text-right tabular-nums">{fmtNumber(r.leads)}</TableCell>
                <TableCell className="py-2 text-right tabular-nums">{fmtPercent(r.replyRate, 1)}</TableCell>
                <TableCell className="py-2 text-right tabular-nums">{fmtPercent(r.winRate, 1)}</TableCell>
                <TableCell className="py-2 text-right tabular-nums text-muted-foreground">
                  {fmtCurrency(r.pipeline)}
                </TableCell>
                <TableCell className="py-2 text-right tabular-nums font-semibold text-emerald-400">
                  {fmtCurrency(r.closedValue)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
