"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
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
import { REVENUE_RANGES } from "@/lib/constants";

import { PageBody, PageHeader } from "@/components/common/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { StageBadge } from "@/components/common/stage-badge";
import { ChannelChip } from "@/components/common/channel-chip";
import { UserChip } from "@/components/common/user-chip";
import { LeadTimeline } from "@/components/leads/lead-timeline";
import { LeadOverview } from "@/components/leads/lead-overview";
import { LeadTouchpoints } from "@/components/leads/lead-touchpoints";
import { LeadNotes } from "@/components/leads/lead-notes";
import { LeadFollowups } from "@/components/leads/lead-followups";
import { WorkspaceEmptyHint } from "@/components/common/workspace-empty-hint";
import { fmtCurrency, fmtDate, fmtRelative, initials } from "@/lib/format";

export function LeadDetailView({ leadId }: { leadId: string }) {
  const ws = useWorkspace();
  const searchParams = useSearchParams();
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
  const followups = ws.followups.filter((f) => f.leadId === lead.id);

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
                <StageBadge stage={lead.stage} />
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
            <Button variant="outline" size="sm">
              <Star className="h-3.5 w-3.5" /> Pin
            </Button>
            <Button variant="outline" size="sm">
              <Share2 className="h-3.5 w-3.5" /> Share
            </Button>
            <Button variant="outline" size="sm">
              <Pencil className="h-3.5 w-3.5" /> Edit
            </Button>
            <Button variant="outline" size="icon-sm">
              <MoreHorizontal className="h-3.5 w-3.5" />
            </Button>
          </>
        }
      />
      <PageBody className="p-0">
        <div className="grid grid-cols-1 xl:grid-cols-[1fr_360px] min-h-[calc(100vh-8rem)]">
          <div className="p-6 border-r">
            <Tabs defaultValue="overview" className="w-full">
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
                    {notes.length}
                  </Badge>
                </TabsTrigger>
                <TabsTrigger value="followups">
                  Followups
                  <Badge variant="secondary" className="ml-1.5 h-4 px-1 text-[10px]">
                    {followups.filter((f) => !f.completedAt).length}
                  </Badge>
                </TabsTrigger>
              </TabsList>

              <div className="mt-4">
                <TabsContent value="overview">
                  <LeadOverview lead={lead} />
                </TabsContent>
                <TabsContent value="timeline">
                  <LeadTimeline events={timeline} />
                </TabsContent>
                <TabsContent value="touchpoints">
                  <LeadTouchpoints touchpoints={touchpoints} />
                </TabsContent>
                <TabsContent value="notes">
                  <LeadNotes notes={notes} />
                </TabsContent>
                <TabsContent value="followups">
                  <LeadFollowups followups={followups} />
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
    </>
  );
}
