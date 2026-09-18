"use client";

import * as React from "react";
import Link from "next/link";
import { Building2, ArrowLeft, Globe, MapPin, Users2, Network as Linkedin, Plus, Pencil } from "lucide-react";

import { PageBody, PageHeader } from "@/components/common/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import { UserChip } from "@/components/common/user-chip";
import { StageBadge } from "@/components/common/stage-badge";
import { ChannelChip } from "@/components/common/channel-chip";
import { KpiCard } from "@/components/common/kpi-card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import { useWorkspace } from "@/components/providers/workspace-mode-provider";
import { WorkspaceEmptyHint } from "@/components/common/workspace-empty-hint";
import { WorkspacePageSkeleton } from "@/components/common/workspace-page-skeleton";
import { REVENUE_RANGES } from "@/lib/constants";
import { fmtCurrency, fmtRelative, fmtDate } from "@/lib/format";
import { EntityLabelPicker } from "@/components/crm/entity-label-picker";
import { AddAccountContactDialog } from "@/components/accounts/add-account-contact-dialog";
import { EditAccountDialog } from "@/components/accounts/edit-account-dialog";

export function AccountDetailView({ accountId }: { accountId: string }) {
  const ws = useWorkspace();
  const [editOpen, setEditOpen] = React.useState(false);
  const [addContactOpen, setAddContactOpen] = React.useState(false);
  const [fetchedAccount, setFetchedAccount] = React.useState<
    (typeof ws.accounts)[number] | null
  >(null);
  const [fetchDone, setFetchDone] = React.useState(false);
  const accountFromWs = ws.accounts.find((a) => a.id === accountId);
  const account = accountFromWs ?? fetchedAccount ?? undefined;

  React.useEffect(() => {
    if (accountFromWs || ws.isDemo) {
      setFetchDone(true);
      return;
    }
    let cancelled = false;
    setFetchDone(false);
    void import("@/lib/crm/fetch-crm-entity-by-id-client").then(({ fetchAccountByIdClient }) =>
      fetchAccountByIdClient(accountId).then((res) => {
        if (cancelled) return;
        if (res.status === "ok") setFetchedAccount(res.entity);
        setFetchDone(true);
      }),
    );
    return () => {
      cancelled = true;
    };
  }, [accountId, accountFromWs, ws.isDemo]);

  if (!account) {
    if (ws.workspaceLoading || (!ws.isDemo && !fetchDone)) {
      return (
        <PageBody>
          <WorkspacePageSkeleton />
        </PageBody>
      );
    }
    return (
      <PageBody className="flex flex-col items-center justify-center gap-4 py-16">
        <p className="text-sm text-muted-foreground">Company not found.</p>
        <Button size="sm" variant="outline" nativeButton={false} render={<Link href="/accounts">Back to companies</Link>} />
        {!ws.isDemo && <WorkspaceEmptyHint />}
      </PageBody>
    );
  }

  const contacts = ws.contacts.filter((c) => c.accountId === account.id);
  const leads = ws.leads.filter((l) => l.accountId === account.id);
  const deals = ws.deals.filter((d) => d.accountId === account.id);
  const openDeals = deals.filter((d) => !["won", "lost"].includes(d.stage));
  const wonDeals = deals.filter((d) => d.stage === "won");

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
                <Link href="/accounts" aria-label="Back to companies">
                  <ArrowLeft className="h-4 w-4" />
                </Link>
              }
            />
            <div className="grid h-9 w-9 place-items-center rounded-md bg-primary/15 text-primary">
              <Building2 className="h-4 w-4" />
            </div>
            <div>
              <div>{account.name}</div>
              <div className="text-xs text-muted-foreground font-normal mt-0.5 flex items-center gap-3">
                {account.domain && (
                  <span className="flex items-center gap-1">
                    <Globe className="h-3 w-3" />
                    {account.domain}
                  </span>
                )}
                {account.location && (
                  <span className="flex items-center gap-1">
                    <MapPin className="h-3 w-3" />
                    {account.location}
                  </span>
                )}
              </div>
            </div>
          </div>
        }
        actions={
          <>
            <Button variant="outline" size="sm" type="button" onClick={() => setEditOpen(true)}>
              <Pencil className="h-3.5 w-3.5" /> Edit
            </Button>
            <Button
              size="sm"
              type="button"
              onClick={() => setAddContactOpen(true)}
            >
              <Plus className="h-3.5 w-3.5" /> Add contact
            </Button>
          </>
        }
      />

      <PageBody>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <KpiCard label="Contacts" value={contacts.length} icon={Users2} />
          <KpiCard label="Open leads" value={leads.filter((l) => !["won", "lost"].includes(l.stage)).length} />
          <KpiCard
            label="Pipeline"
            value={fmtCurrency(openDeals.reduce((s, d) => s + d.value, 0))}
            hint={`${openDeals.length} open deals`}
          />
          <KpiCard
            label="Closed won"
            value={fmtCurrency(wonDeals.reduce((s, d) => s + d.value, 0))}
            hint={`${wonDeals.length} deals`}
          />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6">
          <Tabs defaultValue="contacts" className="w-full">
            <TabsList>
              <TabsTrigger value="contacts">
                Contacts
                <Badge variant="secondary" className="ml-1.5 h-4 px-1 text-[10px]">
                  {contacts.length}
                </Badge>
              </TabsTrigger>
              <TabsTrigger value="leads">
                Leads
                <Badge variant="secondary" className="ml-1.5 h-4 px-1 text-[10px]">
                  {leads.length}
                </Badge>
              </TabsTrigger>
              <TabsTrigger value="deals">
                Deals
                <Badge variant="secondary" className="ml-1.5 h-4 px-1 text-[10px]">
                  {deals.length}
                </Badge>
              </TabsTrigger>
              <TabsTrigger value="activity">Activity</TabsTrigger>
            </TabsList>

            <TabsContent value="contacts" className="mt-4">
              <Card>
                <CardContent className="p-0">
                  <Table>
                    <TableHeader className="bg-muted/30">
                      <TableRow className="hover:bg-transparent">
                        <TableHead className="h-9">Name</TableHead>
                        <TableHead className="h-9">Title</TableHead>
                        <TableHead className="h-9">Email</TableHead>
                        <TableHead className="h-9">Phone</TableHead>
                        <TableHead className="h-9">Owner</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {contacts.map((c) => (
                        <TableRow key={c.id}>
                          <TableCell className="py-2">
                            <Link href={`/contacts/${c.id}`} className="text-sm font-medium hover:text-primary">
                              {c.fullName}
                            </Link>
                          </TableCell>
                          <TableCell className="py-2 text-sm text-muted-foreground">{c.title}</TableCell>
                          <TableCell className="py-2 text-sm text-muted-foreground">{c.email}</TableCell>
                          <TableCell className="py-2 text-sm text-muted-foreground tabular-nums">{c.phone ?? "-"}</TableCell>
                          <TableCell className="py-2">
                            <UserChip userId={c.ownerId} size="xs" />
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="leads" className="mt-4">
              <Card>
                <CardContent className="p-0">
                  <Table>
                    <TableHeader className="bg-muted/30">
                      <TableRow className="hover:bg-transparent">
                        <TableHead className="h-9">Contact</TableHead>
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
                            <Link href={`/leads/${l.id}`} className="text-sm font-medium hover:text-primary">
                              {l.contactName}
                            </Link>
                          </TableCell>
                          <TableCell className="py-2">
                            <ChannelChip channel={l.channel} />
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
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="deals" className="mt-4">
              <Card>
                <CardContent className="p-0">
                  <Table>
                    <TableHeader className="bg-muted/30">
                      <TableRow className="hover:bg-transparent">
                        <TableHead className="h-9">Deal</TableHead>
                        <TableHead className="h-9">Stage</TableHead>
                        <TableHead className="h-9 text-right">Value</TableHead>
                        <TableHead className="h-9 text-right">Prob</TableHead>
                        <TableHead className="h-9">Close</TableHead>
                        <TableHead className="h-9">Owner</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {deals.map((d) => (
                        <TableRow key={d.id}>
                          <TableCell className="py-2 text-sm font-medium">{d.name}</TableCell>
                          <TableCell className="py-2">
                            <StageBadge stage={d.stage} />
                          </TableCell>
                          <TableCell className="py-2 text-right tabular-nums font-semibold">
                            {fmtCurrency(d.value, d.currency)}
                          </TableCell>
                          <TableCell className="py-2 text-right tabular-nums text-muted-foreground">{d.probability}%</TableCell>
                          <TableCell className="py-2 text-xs text-muted-foreground">{fmtDate(d.expectedCloseDate, "MMM d")}</TableCell>
                          <TableCell className="py-2">
                            <UserChip userId={d.ownerId} size="xs" />
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="activity" className="mt-4">
              <Card>
                <CardContent className="p-6 text-sm text-muted-foreground">
                  Aggregated activity across all contacts and leads for this company will render here.
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>

          <aside className="space-y-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-xs uppercase text-muted-foreground tracking-wide">Labels</CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                <EntityLabelPicker
                  labelIds={account.labelIds ?? []}
                  onChange={(next) => ws.patchAccount(account.id, { labelIds: next.length ? next : undefined })}
                />
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-xs uppercase text-muted-foreground tracking-wide">Company</CardTitle>
              </CardHeader>
              <CardContent className="pt-0 space-y-2 text-sm">
                <dl className="grid grid-cols-[92px_1fr] gap-y-1.5 text-xs">
                  <dt className="text-muted-foreground">Industry</dt>
                  <dd>{account.industry}</dd>
                  <dt className="text-muted-foreground">Size</dt>
                  <dd>{account.size}</dd>
                  <dt className="text-muted-foreground">Revenue</dt>
                  <dd>{account.revenueRange ? REVENUE_RANGES[account.revenueRange] : "-"}</dd>
                  <dt className="text-muted-foreground">Founded</dt>
                  <dd>{account.yearFounded ?? "-"}</dd>
                  <dt className="text-muted-foreground">Location</dt>
                  <dd>{account.location}</dd>
                  <dt className="text-muted-foreground">Website</dt>
                  <dd>
                    {account.website ? (
                      <a href={account.website} target="_blank" rel="noreferrer" className="hover:text-primary text-primary/80">
                        {account.domain}
                      </a>
                    ) : (
                      "-"
                    )}
                  </dd>
                  {account.linkedin && (
                    <>
                      <dt className="text-muted-foreground">LinkedIn</dt>
                      <dd>
                        <a
                          href={account.linkedin}
                          target="_blank"
                          rel="noreferrer"
                          className="hover:text-primary text-primary/80 flex items-center gap-1"
                        >
                          <Linkedin className="h-3 w-3" /> Company page
                        </a>
                      </dd>
                    </>
                  )}
                </dl>
                {account.techStack && account.techStack.length > 0 && (
                  <>
                    <Separator />
                    <div className="space-y-1.5">
                      <div className="text-xs text-muted-foreground">Tech stack</div>
                      <div className="flex flex-wrap gap-1">
                        {account.techStack.map((t) => (
                          <Badge key={t} variant="outline" className="text-[10px]">
                            {t}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-xs uppercase text-muted-foreground tracking-wide">Owner</CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                <UserChip userId={account.ownerId} size="md" />
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-xs uppercase text-muted-foreground tracking-wide">Timestamps</CardTitle>
              </CardHeader>
              <CardContent className="pt-0 space-y-1 text-xs">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Created</span>
                  <span>{fmtDate(account.createdAt)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Updated</span>
                  <span>{fmtRelative(account.updatedAt)}</span>
                </div>
              </CardContent>
            </Card>
          </aside>
        </div>
      </PageBody>
      <EditAccountDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        account={account}
        onSave={(patch) => ws.patchAccount(account.id, patch)}
      />
      <AddAccountContactDialog
        open={addContactOpen}
        onOpenChange={setAddContactOpen}
        account={account}
      />
    </>
  );
}
