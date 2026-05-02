"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
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
import { useOpenQuickAdd } from "@/components/layout/quick-add-launcher";
import type { Contact } from "@/lib/types";
import { Plus, Search, Upload, Mail, Phone, CheckCircle2, XCircle, Copy } from "lucide-react";

function contactMatchesQuery(
  c: Contact,
  q: string,
  accounts: { id: string; name: string }[],
  users: { id: string; displayName: string }[],
): boolean {
  if (!q) return true;
  const account = accounts.find((a) => a.id === c.accountId);
  const owner = users.find((u) => u.id === c.ownerId);
  const hay = [
    c.fullName,
    c.email,
    c.title,
    c.phone,
    c.seniority,
    account?.name,
    owner?.displayName,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return hay.includes(q);
}

async function copyText(text: string, label: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(`${label} copied`);
  } catch {
    toast.error("Could not copy to clipboard");
  }
}

function telHref(phone: string) {
  const digits = phone.replace(/[^\d+]/g, "");
  return digits ? `tel:${digits}` : `tel:${phone.trim()}`;
}

export default function ContactsPage() {
  const router = useRouter();
  const { contacts, accounts, users, isDemo } = useWorkspace();
  const { openQuickAdd } = useOpenQuickAdd();
  const [query, setQuery] = React.useState("");
  const q = query.trim().toLowerCase();
  const filtered = contacts.filter((c) => contactMatchesQuery(c, q, accounts, users));

  return (
    <>
      <PageHeader
        title="Contacts"
        description="People at our accounts, deduped by email."
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              nativeButton={false}
              render={
                <Link href="/admin/import">
                  <Upload className="h-3.5 w-3.5" /> Import
                </Link>
              }
            />
            <Button
              size="sm"
              onClick={() => openQuickAdd({ initialPill: "contact" })}
            >
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
                {filtered.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={8} className="h-24 text-center text-sm text-muted-foreground">
                      {q ? "No contacts match your search." : "No contacts."}
                    </TableCell>
                  </TableRow>
                )}
                {filtered.map((c) => {
                  const account = accounts.find((a) => a.id === c.accountId);
                  return (
                    <TableRow
                      key={c.id}
                      className="cursor-pointer"
                      onClick={(e) => {
                        const el = e.target as HTMLElement;
                        if (el.closest("a, button")) return;
                        router.push(`/contacts/${c.id}`);
                      }}
                    >
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
                          <span className="flex max-w-[280px] items-center gap-1.5 text-sm text-muted-foreground">
                            <Mail className="h-3 w-3 shrink-0" />
                            <a
                              href={`mailto:${encodeURIComponent(c.email)}`}
                              className="min-w-0 truncate hover:text-primary hover:underline"
                              onClick={(e) => e.stopPropagation()}
                            >
                              {c.email}
                            </a>
                            {c.emailVerified ? (
                              <span className="shrink-0 text-success" title="Verified">
                                <CheckCircle2 className="h-3 w-3" aria-hidden />
                              </span>
                            ) : (
                              <span className="shrink-0 text-muted-foreground/60" title="Unverified">
                                <XCircle className="h-3 w-3" aria-hidden />
                              </span>
                            )}
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-xs"
                              className="shrink-0 text-muted-foreground hover:text-foreground"
                              title="Copy email"
                              onClick={(e) => {
                                e.stopPropagation();
                                void copyText(c.email!, "Email");
                              }}
                            >
                              <Copy className="h-3 w-3" />
                            </Button>
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="py-2 text-sm text-muted-foreground tabular-nums">
                        {c.phone ? (
                          <a
                            href={telHref(c.phone)}
                            className="inline-flex items-center gap-1 hover:text-primary"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <Phone className="h-3 w-3" />
                            {c.phone}
                          </a>
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
