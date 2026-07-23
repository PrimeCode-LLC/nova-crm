"use client";

import Link from "next/link";
import { ArrowLeft, Mail, Phone, Link as LinkIcon, MapPin, Building2 } from "lucide-react";

import { PageBody, PageHeader } from "@/components/common/page-header";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import { useWorkspace } from "@/components/providers/workspace-mode-provider";
import { UserChip } from "@/components/common/user-chip";
import { StageBadge } from "@/components/common/stage-badge";
import { ChannelChip } from "@/components/common/channel-chip";
import { WorkspaceEmptyHint } from "@/components/common/workspace-empty-hint";
import { initials, fmtRelative } from "@/lib/format";
import { EntityLabelPicker } from "@/components/crm/entity-label-picker";

export function ContactDetailView({ contactId }: { contactId: string }) {
  const ws = useWorkspace();
  const contact = ws.getContactById(contactId);

  if (!contact) {
    return (
      <PageBody className="flex flex-col items-center justify-center gap-4 py-16">
        <p className="text-sm text-muted-foreground">Contact not found.</p>
        <Button size="sm" variant="outline" nativeButton={false} render={<Link href="/contacts">Back to contacts</Link>} />
        {!ws.isDemo && <WorkspaceEmptyHint />}
      </PageBody>
    );
  }

  const account = ws.getAccountById(contact.accountId);
  const leads = ws.leads.filter((l) => l.contactId === contact.id);
  const displayName =
    contact.fullName?.trim() ||
    [contact.firstName, contact.lastName].filter(Boolean).join(" ").trim() ||
    contact.email?.trim() ||
    "Unknown";

  return (
    <>
      <PageHeader
        title={
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="icon-sm"
              nativeButton={false}
              render={
                <Link href="/contacts" aria-label="Back">
                  <ArrowLeft className="h-4 w-4" />
                </Link>
              }
            />
            <Avatar className="h-9 w-9">
              <AvatarFallback className="bg-primary/15 text-primary font-semibold text-sm">
                {initials(displayName)}
              </AvatarFallback>
            </Avatar>
            <div>
              <div>{displayName}</div>
              <div className="text-xs text-muted-foreground font-normal mt-0.5">
                {contact.title} · {account?.name}
              </div>
            </div>
          </div>
        }
        actions={
          <>
            <Button variant="outline" size="sm">
              Edit
            </Button>
          </>
        }
      />
      <PageBody>
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Leads for this contact</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader className="bg-muted/30">
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="h-9">Channel</TableHead>
                    <TableHead className="h-9">Stage</TableHead>
                    <TableHead className="h-9">Owner</TableHead>
                    <TableHead className="h-9">Last activity</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {leads.map((l) => (
                    <TableRow key={l.id}>
                      <TableCell className="py-2">
                        <Link href={`/leads/${l.id}`} className="hover:text-primary">
                          <ChannelChip channel={l.channel} />
                        </Link>
                      </TableCell>
                      <TableCell className="py-2">
                        <StageBadge stage={l.stage} />
                      </TableCell>
                      <TableCell className="py-2">
                        <UserChip userId={l.ownerId} size="xs" />
                      </TableCell>
                      <TableCell className="py-2 text-xs text-muted-foreground">{fmtRelative(l.lastActivityAt)}</TableCell>
                    </TableRow>
                  ))}
                  {leads.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={4} className="py-10 text-center text-sm text-muted-foreground">
                        No leads yet for this contact.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <aside className="space-y-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-xs uppercase text-muted-foreground tracking-wide">Contact info</CardTitle>
              </CardHeader>
              <CardContent className="pt-0 space-y-2 text-sm">
                {contact.email ? (
                  <div className="flex items-center gap-2">
                    <Mail className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    <div className="min-w-0 flex-1">
                      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Company</p>
                      <a href={`mailto:${contact.email}`} className="block truncate hover:text-primary">
                        {contact.email}
                      </a>
                    </div>
                  </div>
                ) : null}
                {contact.personalEmail ? (
                  <div className="flex items-center gap-2">
                    <Mail className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    <div className="min-w-0 flex-1">
                      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Personal</p>
                      <a href={`mailto:${contact.personalEmail}`} className="block truncate hover:text-primary">
                        {contact.personalEmail}
                      </a>
                    </div>
                  </div>
                ) : null}
                {contact.phone && (
                  <div className="flex items-center gap-2">
                    <Phone className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    <span className="tabular-nums">{contact.phone}</span>
                  </div>
                )}
                {contact.linkedin && (
                  <div className="flex items-center gap-2">
                    <LinkIcon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    <a
                      href={contact.linkedin}
                      target="_blank"
                      rel="noreferrer"
                      className="truncate hover:text-primary text-primary/80"
                    >
                      {contact.linkedin.replace("https://", "")}
                    </a>
                  </div>
                )}
                {contact.location && (
                  <div className="flex items-center gap-2">
                    <MapPin className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    <span>{contact.location}</span>
                  </div>
                )}
                {contact.seniority && (
                  <Badge variant="outline" className="text-[10px]">
                    {contact.seniority}
                  </Badge>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-xs uppercase text-muted-foreground tracking-wide">Labels</CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                <EntityLabelPicker
                  labelIds={contact.labelIds ?? []}
                  onChange={(next) => ws.patchContact(contact.id, { labelIds: next.length ? next : undefined })}
                />
              </CardContent>
            </Card>

            {account && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-xs uppercase text-muted-foreground tracking-wide">Company</CardTitle>
                </CardHeader>
                <CardContent className="pt-0">
                  <Link
                    href={`/accounts/${account.id}`}
                    className="flex items-center gap-2 text-sm font-medium hover:text-primary"
                  >
                    <Building2 className="h-4 w-4 text-muted-foreground" />
                    {account.name}
                  </Link>
                  <div className="text-xs text-muted-foreground mt-1">
                    {account.industry} · {account.size}
                  </div>
                </CardContent>
              </Card>
            )}

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-xs uppercase text-muted-foreground tracking-wide">Owner</CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                <UserChip userId={contact.ownerId} size="md" />
              </CardContent>
            </Card>
          </aside>
        </div>
      </PageBody>
    </>
  );
}
