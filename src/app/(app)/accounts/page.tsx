"use client";

import * as React from "react";
import Link from "next/link";
import { PageBody, PageHeader } from "@/components/common/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { mockAccounts } from "@/lib/mock-data";
import { fmtCurrency, fmtNumber, fmtRelative } from "@/lib/format";
import { REVENUE_RANGES } from "@/lib/constants";
import { UserChip } from "@/components/common/user-chip";
import { Building2, Globe, Plus, Search, Upload } from "lucide-react";

export default function AccountsPage() {
  const [query, setQuery] = React.useState("");
  const filtered = mockAccounts.filter(
    (a) =>
      !query ||
      a.name.toLowerCase().includes(query.toLowerCase()) ||
      a.domain?.toLowerCase().includes(query.toLowerCase()) ||
      a.industry?.toLowerCase().includes(query.toLowerCase()),
  );

  return (
    <>
      <PageHeader
        title="Accounts"
        description="Companies we're selling into — deduped by domain."
        actions={
          <>
            <Button variant="outline" size="sm">
              <Upload className="h-3.5 w-3.5" /> Import
            </Button>
            <Button size="sm">
              <Plus className="h-3.5 w-3.5" /> New account
            </Button>
          </>
        }
      />
      <PageBody>
        <div className="flex items-center gap-2">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search accounts…"
              className="pl-8 h-8"
            />
          </div>
        </div>

        <div className="rounded-md border overflow-hidden">
          <div className="overflow-x-auto scrollbar-thin">
            <Table>
              <TableHeader className="bg-muted/30">
                <TableRow className="hover:bg-transparent">
                  <TableHead className="h-9">Company</TableHead>
                  <TableHead className="h-9">Industry</TableHead>
                  <TableHead className="h-9">Size</TableHead>
                  <TableHead className="h-9">Revenue</TableHead>
                  <TableHead className="h-9">Location</TableHead>
                  <TableHead className="h-9 text-right">Contacts</TableHead>
                  <TableHead className="h-9 text-right">Leads</TableHead>
                  <TableHead className="h-9 text-right">Open deals</TableHead>
                  <TableHead className="h-9">Owner</TableHead>
                  <TableHead className="h-9">Updated</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((a) => (
                  <TableRow key={a.id} className="cursor-pointer">
                    <TableCell className="py-2">
                      <Link href={`/accounts/${a.id}`} className="flex items-center gap-2 min-w-0 hover:text-primary">
                        <div className="grid h-7 w-7 place-items-center rounded-md bg-primary/15 text-primary shrink-0">
                          <Building2 className="h-3.5 w-3.5" />
                        </div>
                        <div className="min-w-0">
                          <div className="text-sm font-medium truncate">{a.name}</div>
                          {a.domain && (
                            <div className="text-[11px] text-muted-foreground truncate flex items-center gap-1">
                              <Globe className="h-2.5 w-2.5" />
                              {a.domain}
                            </div>
                          )}
                        </div>
                      </Link>
                    </TableCell>
                    <TableCell className="py-2">
                      <Badge variant="outline" className="text-[10px] font-normal">
                        {a.industry}
                      </Badge>
                    </TableCell>
                    <TableCell className="py-2 text-sm text-muted-foreground">{a.size}</TableCell>
                    <TableCell className="py-2 text-sm text-muted-foreground">
                      {a.revenueRange ? REVENUE_RANGES[a.revenueRange] : "—"}
                    </TableCell>
                    <TableCell className="py-2 text-sm text-muted-foreground">{a.location}</TableCell>
                    <TableCell className="py-2 text-right tabular-nums">{a.contactCount}</TableCell>
                    <TableCell className="py-2 text-right tabular-nums">{a.leadCount}</TableCell>
                    <TableCell className="py-2 text-right tabular-nums">
                      {a.openDealValue > 0 ? (
                        <span className="font-semibold text-emerald-400">{fmtCurrency(a.openDealValue)}</span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="py-2">
                      <UserChip userId={a.ownerId} size="xs" />
                    </TableCell>
                    <TableCell className="py-2 text-xs text-muted-foreground whitespace-nowrap">
                      {fmtRelative(a.updatedAt)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>

        <div className="text-xs text-muted-foreground">
          Showing <span className="tabular-nums font-medium text-foreground">{fmtNumber(filtered.length)}</span> of{" "}
          <span className="tabular-nums">{fmtNumber(mockAccounts.length)}</span> accounts
        </div>
      </PageBody>
    </>
  );
}
