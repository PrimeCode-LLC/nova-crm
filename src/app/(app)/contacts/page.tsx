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
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { useWorkspace } from "@/components/providers/workspace-mode-provider";
import { WorkspaceEmptyHint } from "@/components/common/workspace-empty-hint";
import { fmtRelative, initials } from "@/lib/format";
import { UserChip } from "@/components/common/user-chip";
import { Plus, Search, Upload, Mail, Phone, CheckCircle2, XCircle } from "lucide-react";

export default function ContactsPage() {
  const { contacts, accounts, isDemo } = useWorkspace();
  const [query, setQuery] = React.useState("");
  const filtered = contacts.filter(
    (c) =>
      !query ||
      c.fullName.toLowerCase().includes(query.toLowerCase()) ||
      c.email?.toLowerCase().includes(query.toLowerCase()) ||
      c.title?.toLowerCase().includes(query.toLowerCase()),
  );

  return (
    <>
      <PageHeader
        title="Contacts"
        description="People at our accounts, deduped by email."
        actions={
          <>
            <Button variant="outline" size="sm">
              <Upload className="h-3.5 w-3.5" /> Import
            </Button>
            <Button size="sm">
              <Plus className="h-3.5 w-3.5" /> New contact
            </Button>
          </>
        }
      />
      <PageBody>
        {!isDemo && contacts.length === 0 ? (
          <WorkspaceEmptyHint title="No contacts in workspace" />
        ) : (
          <>
        <div className="flex items-center gap-2">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search contacts…"
              className="pl-8 h-8"
            />
          </div>
        </div>

        <div className="rounded-md border overflow-hidden">
          <div className="overflow-x-auto scrollbar-thin">
            <Table>
              <TableHeader className="bg-muted/30">
                <TableRow className="hover:bg-transparent">
                  <TableHead className="h-9">Name</TableHead>
                  <TableHead className="h-9">Title</TableHead>
                  <TableHead className="h-9">Company</TableHead>
                  <TableHead className="h-9">Email</TableHead>
                  <TableHead className="h-9">Phone</TableHead>
                  <TableHead className="h-9">Seniority</TableHead>
                  <TableHead className="h-9">Owner</TableHead>
                  <TableHead className="h-9">Updated</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((c) => {
                  const account = accounts.find((a) => a.id === c.accountId);
                  return (
                    <TableRow key={c.id} className="cursor-pointer">
                      <TableCell className="py-2">
                        <Link href={`/contacts/${c.id}`} className="flex items-center gap-2 hover:text-primary">
                          <Avatar className="h-7 w-7">
                            <AvatarFallback className="bg-primary/15 text-primary text-[10px] font-semibold">
                              {initials(c.fullName)}
                            </AvatarFallback>
                          </Avatar>
                          <span className="text-sm font-medium">{c.fullName}</span>
                        </Link>
                      </TableCell>
                      <TableCell className="py-2 text-sm text-muted-foreground">{c.title}</TableCell>
                      <TableCell className="py-2 text-sm">
                        {account && (
                          <Link
                            href={`/accounts/${account.id}`}
                            className="hover:text-primary"
                          >
                            {account.name}
                          </Link>
                        )}
                      </TableCell>
                      <TableCell className="py-2">
                        {c.email && (
                          <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
                            <Mail className="h-3 w-3" />
                            <span className="truncate max-w-[220px]">{c.email}</span>
                            {c.emailVerified ? (
                              <CheckCircle2 className="h-3 w-3 text-emerald-400" />
                            ) : (
                              <XCircle className="h-3 w-3 text-muted-foreground/60" />
                            )}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="py-2 text-sm text-muted-foreground tabular-nums">
                        {c.phone ? (
                          <span className="flex items-center gap-1">
                            <Phone className="h-3 w-3" />
                            {c.phone}
                          </span>
                        ) : (
                          "-"
                        )}
                      </TableCell>
                      <TableCell className="py-2">
                        {c.seniority && (
                          <Badge variant="outline" className="text-[10px]">
                            {c.seniority}
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="py-2">
                        <UserChip userId={c.ownerId} size="xs" />
                      </TableCell>
                      <TableCell className="py-2 text-xs text-muted-foreground whitespace-nowrap">
                        {fmtRelative(c.updatedAt)}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </div>
          </>
        )}
      </PageBody>
    </>
  );
}
