"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import {
  Building2,
  Mail,
  Phone,
  Link as LinkIcon,
  MapPin,
  Sparkles,
  ArrowLeft,
  Pencil,
  Share2,
  Star,
  MoreHorizontal,
} from "lucide-react";

import { useWorkspace } from "@/components/providers/workspace-mode-provider";
import { PIPELINE_STAGES, REVENUE_RANGES, STAGES_BY_KEY } from "@/lib/constants";

import { PageBody, PageHeader } from "@/components/common/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { STAGE_TONE_CLASS } from "@/components/common/stage-badge";
import { ChannelChip } from "@/components/common/channel-chip";
import { UserChip } from "@/components/common/user-chip";
import { LeadTimeline } from "@/components/leads/lead-timeline";
import { LeadOverview } from "@/components/leads/lead-overview";
import { LeadTouchpoints } from "@/components/leads/lead-touchpoints";
import { LeadNotes } from "@/components/leads/lead-notes";
import { LeadFollowups } from "@/components/leads/lead-followups";
import { WorkspaceEmptyHint } from "@/components/common/workspace-empty-hint";
import { fmtCurrency, fmtDate, fmtRelative, initials } from "@/lib/format";
import { cn } from "@/lib/utils";
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
import { EditLeadDialog } from "@/components/leads/edit-lead-dialog";
import type { Lead, PipelineStage } from "@/lib/types";
import { useEmailAccountStore } from "@/stores/email-account-store";

const LEAD_TABS = ["overview", "timeline", "touchpoints", "notes", "followups", "emails"] as const;
type LeadTab = (typeof LEAD_TABS)[number];

function tabFromSearchParams(searchParams: ReturnType<typeof useSearchParams>): LeadTab {
  const raw = searchParams.get("tab");
  if (raw && (LEAD_TABS as readonly string[]).includes(raw)) {
    return raw as LeadTab;
  }
  return "overview";
}

export function LeadDetailView({ leadId }: { leadId: string }) {
  const ws = useWorkspace();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const tabFromUrl = React.useMemo(() => tabFromSearchParams(searchParams), [searchParams]);
  const [activeTab, setActiveTab] = React.useState<LeadTab>(tabFromUrl);
  const [editOpen, setEditOpen] = React.useState(false);
  React.useEffect(() => {
    setActiveTab(tabFromUrl);
  }, [tabFromUrl]);

  const onTabChange = React.useCallback(
    (v: string) => {
      const t = v as LeadTab;
      setActiveTab(t);
      const p = new URLSearchParams(searchParams.toString());
      p.set("tab", t);
      const qs = p.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [pathname, router, searchParams],
  );

  const backHref = searchParams.get("from") === "pipeline" ? "/pipeline" : "/leads";
  const lead = ws.getLeadById(leadId);

  if (!lead) {
    return (
      <PageBody className="flex flex-col items-center justify-center gap-4 py-16">
        <p className="text-sm text-muted-foreground">This lead was not found in your current workspace.</p>
        <Button
          size="sm"
          variant="outline"
          nativeButton={false}
          render={
            <Link href={backHref}>{backHref === "/pipeline" ? "Back to pipeline" : "Back to leads"}</Link>
          }
        />
        {!ws.isDemo && <WorkspaceEmptyHint />}
      </PageBody>
    );
  }

  const account = ws.getAccountById(lead.accountId);
  const contact = ws.getContactById(lead.contactId);
  const campaign = ws.getCampaignById(lead.campaignId);
  const profile = ws.getProfileById(lead.profileId);
  const touchpoints = ws.touchpoints.filter((t) => t.leadId === lead.id);
  const timeline = ws.timelineByLead[lead.id] ?? [];
  const notes = ws.notes.filter((n) => n.leadId === lead.id);
  const notesTabCount = notes.length + (lead.notes?.trim() ? 1 : 0);
  const followups = ws.followups.filter((f) => f.leadId === lead.id);
  const inboundByMailbox = useEmailAccountStore((s) => s.inboundByMailbox);
  const sent = useEmailAccountStore((s) => s.sent);
  const linkedLeadByMessageId = useEmailAccountStore((s) => s.linkedLeadByMessageId);
  const relatedEmails = React.useMemo(() => {
    const own = (lead.contactEmail ?? "").toLowerCase();
    const rows: { id: string; subject: string; at: string; from: string; to: string; body: string }[] = [];
    for (const [mailboxId, messages] of Object.entries(inboundByMailbox)) {
      for (const m of messages) {
        const mid = `${mailboxId}:in:${m.id}`;
        const manual = linkedLeadByMessageId[mid] === lead.id;
        const auto = !!own && `${m.from} ${m.to}`.toLowerCase().includes(own);
        if (!manual && !auto) continue;
        rows.push({ id: mid, subject: m.subject, at: m.date, from: m.from, to: m.to, body: m.bodyText });
      }
    }
    for (const m of sent) {
      const manual = linkedLeadByMessageId[m.id] === lead.id;
      const auto = !!own && `${m.from} ${m.to}`.toLowerCase().includes(own);
      if (!manual && !auto) continue;
      rows.push({ id: m.id, subject: m.subject, at: m.sentAt, from: m.from, to: m.to, body: m.body });
    }
    return rows.sort((a, b) => (a.at < b.at ? 1 : -1));
  }, [inboundByMailbox, linkedLeadByMessageId, lead.contactEmail, lead.id, sent]);

  const pinned = ws.isLeadPinned(lead.id);

  async function copyToClipboard(text: string, okMsg: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(okMsg);
    } catch {
      toast.error("Could not copy to clipboard");
    }
  }

  function handleSaveLead(patch: Partial<Lead>) {
    const latest = ws.getLeadById(leadId);
    if (!latest) return;
    const nextStage = patch.stage;
    if (nextStage != null && nextStage !== latest.stage) {
      ws.updateLeadStage(latest.id, nextStage, latest.stage, ws.currentUserId);
    }
    const { stage: _removed, ...rest } = patch;
    if (Object.keys(rest).length > 0) {
      ws.patchLead(latest.id, rest);
    }
    ws.bumpLeadActivity(latest.id);
  }

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
                <Link href={backHref} aria-label={backHref === "/pipeline" ? "Back to pipeline" : "Back to leads"}>
                  <ArrowLeft className="h-4 w-4" />
                </Link>
              }
            />
            <Avatar className="h-9 w-9">
              <AvatarFallback className="bg-primary/15 text-primary font-semibold text-sm">
                {initials(lead.contactName)}
              </AvatarFallback>
            </Avatar>
            <div>
              <div className="flex items-center gap-2">
                <span className="truncate">{lead.contactName}</span>
                <Select
                  value={lead.stage}
                  onValueChange={(v) => {
                    if (!v || v === lead.stage) return;
                    const next = v as PipelineStage;
                    handleSaveLead({ stage: next });
                    toast.success(`Stage → ${STAGES_BY_KEY[next].label}`);
                  }}
                >
                  <SelectTrigger
                    size="sm"
                    className={cn(
                      "h-7 w-fit min-w-30 gap-1 rounded-md border font-medium capitalize shadow-none",
                      STAGE_TONE_CLASS[STAGES_BY_KEY[lead.stage].tone],
                    )}
                  >
                    <SelectValue>
                      <span className="flex items-center gap-1.5">
                        <span className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-current opacity-80" />
                        {STAGES_BY_KEY[lead.stage].label}
                      </span>
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {PIPELINE_STAGES.map((s) => (
                      <SelectItem key={s.key} value={s.key}>
                        {s.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <ChannelChip channel={lead.channel} />
              </div>
              <div className="text-xs text-muted-foreground font-normal mt-0.5">
                {lead.contactTitle} · {lead.companyName}
              </div>
            </div>
          </div>
        }
        actions={
          <>
            <Button
              variant={pinned ? "default" : "outline"}
              size="sm"
              type="button"
              onClick={() => {
                ws.toggleLeadPin(lead.id);
                toast.success(pinned ? "Unpinned" : "Pinned for this session");
              }}
            >
              <Star className={cn("h-3.5 w-3.5", pinned && "fill-current")} /> Pin
            </Button>
            <Button
              variant="outline"
              size="sm"
              type="button"
              onClick={() => {
                const url = typeof window !== "undefined" ? window.location.href : "";
                void copyToClipboard(url, "Link copied");
              }}
            >
              <Share2 className="h-3.5 w-3.5" /> Share
            </Button>
            <Button variant="outline" size="sm" type="button" onClick={() => setEditOpen(true)}>
              <Pencil className="h-3.5 w-3.5" /> Edit
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button variant="outline" size="icon-sm" aria-label="More actions">
                    <MoreHorizontal className="h-3.5 w-3.5" />
                  </Button>
                }
              />
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  onSelect={() => {
                    const url = typeof window !== "undefined" ? window.location.href : "";
                    void copyToClipboard(url, "Link copied");
                  }}
                >
                  Copy link
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => void copyToClipboard(lead.id, "Lead ID copied")}>
                  Copy lead ID
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        }
      />
      <PageBody className="p-0">
        <div className="grid grid-cols-1 xl:grid-cols-[1fr_360px] min-h-[calc(100vh-8rem)]">
          <div className="p-6 border-r">
            <Tabs value={activeTab} onValueChange={onTabChange} className="w-full">
              <TabsList>
                <TabsTrigger value="overview">Overview</TabsTrigger>
                <TabsTrigger value="timeline">
                  Timeline
                  <Badge variant="secondary" className="ml-1.5 h-4 px-1 text-[10px]">
                    {timeline.length}
                  </Badge>
                </TabsTrigger>
                <TabsTrigger value="touchpoints">
                  Touchpoints
                  <Badge variant="secondary" className="ml-1.5 h-4 px-1 text-[10px]">
                    {touchpoints.length}
                  </Badge>
                </TabsTrigger>
                <TabsTrigger value="notes">
                  Notes
                  <Badge variant="secondary" className="ml-1.5 h-4 px-1 text-[10px]">
                    {notesTabCount}
                  </Badge>
                </TabsTrigger>
                <TabsTrigger value="followups">
                  Followups
                  <Badge variant="secondary" className="ml-1.5 h-4 px-1 text-[10px]">
                    {followups.filter((f) => !f.completedAt).length}
                  </Badge>
                </TabsTrigger>
                <TabsTrigger value="emails">
                  Emails
                  <Badge variant="secondary" className="ml-1.5 h-4 px-1 text-[10px]">
                    {relatedEmails.length}
                  </Badge>
                </TabsTrigger>
              </TabsList>

              <div className="mt-4">
                <TabsContent value="overview">
                  <LeadOverview lead={lead} />
                </TabsContent>
                <TabsContent value="timeline">
                  <LeadTimeline events={timeline} lead={lead} />
                </TabsContent>
                <TabsContent value="touchpoints">
                  <LeadTouchpoints touchpoints={touchpoints} lead={lead} />
                </TabsContent>
                <TabsContent value="notes">
                  <LeadNotes notes={notes} leadId={lead.id} leadProfileNotes={lead.notes} />
                </TabsContent>
                <TabsContent value="followups">
                  <LeadFollowups followups={followups} lead={lead} />
                </TabsContent>
                <TabsContent value="emails">
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm">Email thread history</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      {relatedEmails.length === 0 ? (
                        <p className="text-sm text-muted-foreground">
                          No linked emails yet. Open Inbox and link a message to this lead.
                        </p>
                      ) : (
                        relatedEmails.map((m) => (
                          <div key={m.id} className="rounded-md border p-3 space-y-1">
                            <p className="text-sm font-medium">{m.subject || "(no subject)"}</p>
                            <p className="text-xs text-muted-foreground">
                              {fmtRelative(m.at)} - From {m.from} - To {m.to}
                            </p>
                            <p className="text-xs whitespace-pre-wrap text-muted-foreground">{m.body.slice(0, 3000)}</p>
                          </div>
                        ))
                      )}
                      <Button
                        size="sm"
                        variant="outline"
                        nativeButton={false}
                        render={<Link href="/inbox">Open inbox</Link>}
                      />
                    </CardContent>
                  </Card>
                </TabsContent>
              </div>
            </Tabs>
          </div>

          <aside className="p-6 bg-muted/20 space-y-6">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-xs uppercase text-muted-foreground tracking-wide">Owner</CardTitle>
              </CardHeader>
              <CardContent className="pt-0 space-y-2">
                <UserChip userId={lead.ownerId} size="md" />
                {lead.scraperId && (
                  <div className="text-xs text-muted-foreground flex items-center gap-2">
                    <span>Sourced by</span>
                    <UserChip userId={lead.scraperId} size="xs" />
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-xs uppercase text-muted-foreground tracking-wide">Contact</CardTitle>
              </CardHeader>
              <CardContent className="pt-0 space-y-2 text-sm">
                {contact?.email && (
                  <div className="flex items-center gap-2">
                    <Mail className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    <a href={`mailto:${contact.email}`} className="truncate hover:text-primary">
                      {contact.email}
                    </a>
                  </div>
                )}
                {contact?.phone && (
                  <div className="flex items-center gap-2">
                    <Phone className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    <span className="tabular-nums">{contact.phone}</span>
                  </div>
                )}
                {contact?.linkedin && (
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
                {contact?.location && (
                  <div className="flex items-center gap-2">
                    <MapPin className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    <span>{contact.location}</span>
                  </div>
                )}
              </CardContent>
            </Card>

            {account && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-xs uppercase text-muted-foreground tracking-wide flex items-center justify-between">
                    Company
                    <Link
                      href={`/accounts/${account.id}`}
                      className="text-[10px] normal-case text-primary/90 hover:text-primary"
                    >
                      View account →
                    </Link>
                  </CardTitle>
                </CardHeader>
                <CardContent className="pt-0 space-y-2 text-sm">
                  <div className="flex items-center gap-2 font-medium">
                    <Building2 className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    {account.name}
                  </div>
                  <Separator />
                  <dl className="grid grid-cols-[88px_1fr] gap-y-1.5 text-xs">
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
                        <a
                          href={account.website}
                          target="_blank"
                          rel="noreferrer"
                          className="hover:text-primary text-primary/80"
                        >
                          {account.domain}
                        </a>
                      ) : (
                        "-"
                      )}
                    </dd>
                  </dl>
                  {account.techStack && account.techStack.length > 0 && (
                    <>
                      <Separator />
                      <div className="flex flex-wrap gap-1">
                        {account.techStack.map((t) => (
                          <Badge key={t} variant="outline" className="text-[10px]">
                            {t}
                          </Badge>
                        ))}
                      </div>
                    </>
                  )}
                </CardContent>
              </Card>
            )}

            {(campaign || profile) && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-xs uppercase text-muted-foreground tracking-wide">
                    Attribution
                  </CardTitle>
                </CardHeader>
                <CardContent className="pt-0 space-y-2 text-sm">
                  {campaign && (
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-muted-foreground text-xs">Campaign</span>
                      <span className="truncate">{campaign.name}</span>
                    </div>
                  )}
                  {profile && (
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-muted-foreground text-xs">Profile</span>
                      <span className="truncate">{profile.name}</span>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-xs uppercase text-muted-foreground tracking-wide flex items-center gap-1.5">
                  <Sparkles className="h-3 w-3" /> Insights
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0 space-y-2 text-xs text-muted-foreground">
                <p>
                  Response time was{" "}
                  <span className="font-semibold text-foreground tabular-nums">
                    {lead.responseTimeMinutes ? `${lead.responseTimeMinutes}m` : "n/a"}
                  </span>
                  {lead.responseTimeMinutes && lead.responseTimeMinutes < 60
                    ? ", in the top 10%."
                    : ", slower than team average."}
                </p>
                <p>
                  Last activity {fmtRelative(lead.lastActivityAt)} · {lead.touches} touches total.
                </p>
                {lead.estimatedValue && (
                  <p>
                    Estimated value{" "}
                    <span className="font-semibold text-foreground">{fmtCurrency(lead.estimatedValue)}</span>
                    {lead.expectedCloseDate && ` · close ${fmtDate(lead.expectedCloseDate, "MMM d")}`}
                  </p>
                )}
              </CardContent>
            </Card>
          </aside>
        </div>
      </PageBody>

      <EditLeadDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        lead={lead}
        onSave={handleSaveLead}
      />
    </>
  );
}
