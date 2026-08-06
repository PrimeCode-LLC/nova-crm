"use client";

import * as React from "react";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import type { Account, Campaign, Contact, Deal, Lead, Profile } from "@/lib/types";
import {
  CHANNELS,
  INTAKE_KIND_META,
  PRIORITY_TONE,
  PUSH_STATUS_TONE,
  TEMPERATURE_TONE,
} from "@/lib/constants";
import { fmtCurrency, fmtDate, fmtRelative } from "@/lib/format";
import { cn } from "@/lib/utils";
import { AlertTriangle, ChevronDown, Loader2, MailWarning, Pencil, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { UserChip } from "@/components/common/user-chip";
import type { LeadEditSection } from "@/components/leads/edit-lead-dialog";
import { LeadSourceButton } from "@/components/leads/lead-source-button";
import { LeadCampaignBadge } from "@/components/leads/lead-campaign-badge";
import { getLeadScraperSource } from "@/lib/scrapers/lead-scraper-source";
import {
  getScraperCategoryLabel,
  getScraperPlatformLabel,
} from "@/lib/scrapers/labels";
import { useWorkspace } from "@/components/providers/workspace-mode-provider";
import { EntityLabelPicker } from "@/components/crm/entity-label-picker";
import { useLeadEmailResponseContext } from "@/hooks/use-lead-email-response-context";
import { resolveLeadResponseTimeMinutes } from "@/lib/email/lead-response-time";
import { contactHasBouncedEmail } from "@/lib/email/contact-email-change";
import {
  emailVerificationBadgeClass,
  emailVerificationDescription,
  emailVerificationLabel,
  resolveEmailVerificationStatus,
  shouldOfferEmailVerify,
} from "@/lib/email/email-verification-status";
import {
  formatVerifySummary,
  verifyLeadEmailsClient,
} from "@/lib/integrations/millionverifier/verify-client";
import { LeadIntentQualityCard } from "@/components/leads/lead-intent-quality-card";
import type {
  BuyerPersona,
  ProspectingStrategy,
  StrategyAssignment,
} from "@/lib/prospecting-strategy/types";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { MarkdownContent } from "@/components/common/markdown-content";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[140px_1fr] gap-3 items-start py-2 border-b last:border-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm min-w-0">{children}</dd>
    </div>
  );
}

function Values({ values }: { values?: readonly string[] }) {
  return values?.length ? (
    <div className="flex flex-wrap gap-1">
      {values.map((value) => (
        <Badge key={value} variant="outline" className="text-[10px] font-normal">
          {value}
        </Badge>
      ))}
    </div>
  ) : (
    "-"
  );
}

function humanizeValue(value?: string): string {
  if (!value?.trim()) return "-";
  const text = value.replace(/[_-]+/g, " ").trim();
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function ExternalValue({ href, children }: { href?: string; children?: React.ReactNode }) {
  return href ? (
    <a href={href} target="_blank" rel="noreferrer" className="break-all text-primary/80 hover:text-primary">
      {children ?? href}
    </a>
  ) : (
    "-"
  );
}

function EditCardAction({ onClick }: { onClick?: () => void }) {
  return onClick ? (
    <CardAction>
      <Button type="button" variant="ghost" size="sm" onClick={onClick}>
        <Pencil className="h-3.5 w-3.5" /> Edit
      </Button>
    </CardAction>
  ) : null;
}

export function LeadOverview({
  lead,
  account,
  contact,
  deal,
  campaign,
  profile,
  strategy,
  persona,
  strategyAssignment,
  outreachProfileSummary,
  outreachProfileFieldLabel,
  onEditSection,
  onEditRecord,
  onUpdateEmail,
}: {
  lead: Lead;
  account?: Account;
  contact?: Contact;
  deal?: Deal;
  campaign?: Campaign;
  profile?: Profile;
  strategy?: ProspectingStrategy;
  persona?: BuyerPersona;
  strategyAssignment?: StrategyAssignment;
  /** When set (Upwork / job apply), show which workspace profile this lead uses. */
  outreachProfileSummary?: string;
  outreachProfileFieldLabel?: string;
  onEditSection?: (section: Exclude<LeadEditSection, "all">) => void;
  onEditRecord?: (section: "contact" | "company") => void;
  onUpdateEmail?: () => void;
}) {
  const ws = useWorkspace();
  const [intelligenceOpen, setIntelligenceOpen] = React.useState(false);
  const [verifyingEmail, setVerifyingEmail] = React.useState(false);
  const canEdit = ws.canEditLead(lead);
  const emailBounced = contactHasBouncedEmail(contact);
  const companyEmail = (contact?.email || lead.contactEmail || "").trim();
  const emailStatus = resolveEmailVerificationStatus(contact, lead);
  const showVerify = canEdit && Boolean(companyEmail) && !ws.isDemo && shouldOfferEmailVerify(emailStatus);
  const emailResponseCtx = useLeadEmailResponseContext();
  const responseTimeMinutes = resolveLeadResponseTimeMinutes(lead, emailResponseCtx);
  const openQueue = !lead.ownerId?.trim();
  const scraperSource = getLeadScraperSource(lead);
  const sourceProspect = lead.prospectSourceId
    ? ws.getLeadById(lead.prospectSourceId)
    : undefined;
  const linkedSalesLead = lead.linkedSalesLeadId
    ? ws.getLeadById(lead.linkedSalesLeadId)
    : undefined;

  async function handleVerifyEmail() {
    if (!companyEmail || verifyingEmail || ws.isDemo) return;
    setVerifyingEmail(true);
    try {
      const { results, summary } = await verifyLeadEmailsClient([lead.id]);
      const first = results[0];
      if (first?.error && !first.status) {
        toast.error(first.error);
        return;
      }
      toast.success(formatVerifySummary(summary), {
        description: first?.status
          ? `${companyEmail} → ${emailVerificationLabel(first.status)}`
          : undefined,
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Email verification failed");
    } finally {
      setVerifyingEmail(false);
    }
  }
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <LeadIntentQualityCard
        lead={lead}
        playbook={ws.intentPlaybook}
        crmLabels={ws.crmLabels}
        canEdit={canEdit}
      />

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Labels</CardTitle>
          <EditCardAction
            onClick={canEdit && onEditSection ? () => onEditSection("labels") : undefined}
          />
        </CardHeader>
        <CardContent className="pt-0">
          <EntityLabelPicker
            emphasizeAddAction
            labelIds={lead.labelIds ?? []}
            disabled={!canEdit}
            onChange={(next) => ws.patchLead(lead.id, { labelIds: next.length ? next : undefined })}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Contact record</CardTitle>
          {(canEdit && contact && (onUpdateEmail || onEditRecord)) ? (
            <CardAction className="flex items-center gap-1">
              {onUpdateEmail ? (
                <Button
                  type="button"
                  size="sm"
                  variant={emailBounced ? "default" : "ghost"}
                  className="h-7 gap-1 px-2 text-xs"
                  onClick={onUpdateEmail}
                >
                  {emailBounced ? <MailWarning className="h-3.5 w-3.5" /> : null}
                  {emailBounced ? "Update email" : "Change email"}
                </Button>
              ) : null}
              {onEditRecord ? (
                <Button type="button" variant="ghost" size="sm" onClick={() => onEditRecord("contact")}>
                  <Pencil className="h-3.5 w-3.5" /> Edit
                </Button>
              ) : null}
            </CardAction>
          ) : null}
        </CardHeader>
        <CardContent className="pt-0">
          <dl className="divide-y">
            <Field label="Name">{contact?.fullName || lead.contactName || "-"}</Field>
            <Field label="Title">{contact?.title || lead.contactTitle || "-"}</Field>
            <Field label="Seniority">{contact?.seniority || "-"}</Field>
            <Field label="Company email">{contact?.email || lead.contactEmail || "-"}</Field>
            <Field label="Personal email">{contact?.personalEmail || "-"}</Field>
            <Field label="Email status">
              <span className="inline-flex flex-wrap items-center gap-1.5">
                <Badge
                  variant="outline"
                  className={cn("text-[10px] font-medium", emailVerificationBadgeClass(emailStatus))}
                  title={emailVerificationDescription(emailStatus)}
                >
                  {emailStatus === "bounced" ? (
                    <MailWarning className="mr-1 h-3 w-3" />
                  ) : null}
                  {emailVerificationLabel(emailStatus)}
                </Badge>
                {emailBounced && canEdit && onUpdateEmail ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-6 px-2 text-[11px]"
                    onClick={onUpdateEmail}
                  >
                    Fix
                  </Button>
                ) : null}
                {showVerify ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-6 px-2 text-[11px]"
                    disabled={verifyingEmail}
                    onClick={() => void handleVerifyEmail()}
                  >
                    {verifyingEmail ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <ShieldCheck className="h-3 w-3" />
                    )}
                    {emailBounced ? "Re-verify" : "Verify email"}
                  </Button>
                ) : null}
              </span>
            </Field>
            <Field label="Phone">{contact?.phone || "-"}</Field>
            <Field label="LinkedIn">
              <ExternalValue href={contact?.linkedin || lead.contactLinkedIn} />
            </Field>
            <Field label="Location">{contact?.location || "-"}</Field>
            <Field label="Best channel">{contact?.bestContactChannel || "-"}</Field>
            <Field label="Source">{contact?.contactSource || "-"}</Field>
            <Field label="Contact record dates">
              {contact ? `${contact.createdAt} · updated ${contact.updatedAt}` : "-"}
            </Field>
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Company record</CardTitle>
          <EditCardAction
            onClick={canEdit && account && onEditRecord ? () => onEditRecord("company") : undefined}
          />
        </CardHeader>
        <CardContent className="pt-0">
          <dl className="divide-y">
            <Field label="Company">{account?.name || lead.companyName || "-"}</Field>
            <Field label="Domain">{account?.domain || lead.companyDomain || "-"}</Field>
            <Field label="Industry">{account?.industry || lead.companyIndustry || "-"}</Field>
            <Field label="Description">{account?.businessDescription || "-"}</Field>
            <Field label="Size">{account?.size || lead.companySize || "-"}</Field>
            <Field label="Revenue">{account?.revenueRange || lead.revenueRange || "-"}</Field>
            <Field label="Location">
              {[account?.city, account?.state, account?.country].filter(Boolean).join(", ") ||
                account?.location ||
                "-"}
            </Field>
            <Field label="Founded">{account?.yearFounded ?? "-"}</Field>
            <Field label="Business status">{account?.businessStatus || "-"}</Field>
            <Field label="Website">
              <ExternalValue href={account?.website}>{account?.domain || account?.website}</ExternalValue>
            </Field>
            <Field label="Website status">{account?.websiteStatus || "-"}</Field>
            <Field label="Company LinkedIn">
              <ExternalValue href={account?.linkedin} />
            </Field>
            <Field label="Technology"><Values values={account?.techStack} /></Field>
            <Field label="Online activity">{account?.onlineActivityScore || "-"}</Field>
            <Field label="Last site activity">
              {[account?.lastWebsiteActivityAt, account?.lastWebsiteActivityNote]
                .filter(Boolean)
                .join(" · ") || "-"}
            </Field>
            <Field label="Careers page"><ExternalValue href={account?.careersPageUrl} /></Field>
            <Field label="CRM totals">
              {account
                ? `${account.contactCount} contact(s) · ${account.leadCount} lead(s) · ${fmtCurrency(account.openDealValue)} open`
                : "-"}
            </Field>
            <Field label="Company record dates">
              {account ? `${account.createdAt} · updated ${account.updatedAt}` : "-"}
            </Field>
          </dl>
        </CardContent>
      </Card>

      {deal ? (
        <Card className="lg:col-span-2">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Deal record</CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <dl className="divide-y">
              <Field label="Name">{deal.name}</Field>
              <Field label="Stage">{deal.stage}</Field>
              <Field label="Value">{fmtCurrency(deal.value)} {deal.currency}</Field>
              <Field label="Probability">{deal.probability}%</Field>
              <Field label="Expected close">{fmtDate(deal.expectedCloseDate)}</Field>
              <Field label="Products"><Values values={deal.products} /></Field>
              <Field label="Deal notes">{deal.notes || "-"}</Field>
              <Field label="Outcome">
                {deal.wonAt
                  ? `Won ${fmtDate(deal.wonAt)}`
                  : deal.lostAt
                    ? `Lost ${fmtDate(deal.lostAt)}${deal.lostReason ? ` · ${deal.lostReason}` : ""}`
                    : "Open"}
              </Field>
            </dl>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Intake & ownership</CardTitle>
          <EditCardAction
            onClick={canEdit && onEditSection ? () => onEditSection("intake") : undefined}
          />
        </CardHeader>
        <CardContent className="pt-0">
          <dl className="divide-y">
            <Field label="Added by">
              {lead.createdById?.trim() ? (
                <UserChip userId={lead.createdById} size="sm" />
              ) : (
                <span className="text-muted-foreground">Not recorded (legacy)</span>
              )}
            </Field>
            <Field label="Owner">
              {openQueue ? (
                <div className="flex flex-col gap-1">
                  <Badge variant="secondary" className="w-fit text-[10px] font-normal">
                    Open queue, unclaimed
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    Visible to everyone until someone claims it. Use the Timeline tab for stage changes and activity.
                  </span>
                </div>
              ) : (
                <UserChip userId={lead.ownerId} size="sm" />
              )}
            </Field>
            {lead.scraperId?.trim() ? (
              <Field label="Lead by (sourced by)">
                <UserChip userId={lead.scraperId} size="sm" />
              </Field>
            ) : null}
            {scraperSource ? (
              <Field label="Intake source">
                <div className="flex flex-col gap-2">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                    {scraperSource.feedName ? (
                      <span className="font-medium">{scraperSource.feedName}</span>
                    ) : null}
                    {scraperSource.platform ? (
                      <span className="text-muted-foreground">
                        {getScraperPlatformLabel(scraperSource.platform)}
                      </span>
                    ) : null}
                    {scraperSource.category ? (
                      <span className="text-muted-foreground">
                        · {getScraperCategoryLabel(scraperSource.category)}
                      </span>
                    ) : null}
                  </div>
                  <LeadSourceButton lead={lead} variant="outline" size="sm" className="w-fit" />
                </div>
              </Field>
            ) : null}
          </dl>
        </CardContent>
      </Card>

      {/* Research & personalization */}
      <Card className="lg:col-span-2">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Research & personalization</CardTitle>
          {canEdit && onEditSection ? (
            <CardAction>
              <Button type="button" variant="ghost" size="sm" onClick={() => onEditSection("research")}>
                <Pencil className="h-3.5 w-3.5" /> Edit
              </Button>
            </CardAction>
          ) : null}
        </CardHeader>
        <CardContent className="pt-0">
          <dl className="divide-y">
            <Field label="Trigger event">
              {lead.triggerEvent ? (
                <span>{lead.triggerEvent}</span>
              ) : (
                <Badge
                  variant="outline"
                  className="bg-warning/10 text-warning border-warning/20 gap-1"
                >
                  <AlertTriangle className="h-3 w-3" /> Required: fill before pushing
                </Badge>
              )}
            </Field>
            <Field label="Business focus">{lead.businessFocus ?? "-"}</Field>
            <Field label="Pain points">{lead.painPoints ?? "-"}</Field>
            <Field label="Recent news">{lead.recentNews ?? "-"}</Field>
            <Field label="Hiring signals">{lead.hiringSignals ?? "-"}</Field>
            <Field label="P.S. line">{lead.psLine ?? "-"}</Field>
            <Field label="Tools used">
              {lead.toolsUsed?.length ? (
                <div className="flex flex-wrap gap-1">
                  {lead.toolsUsed.map((t) => (
                    <Badge key={t} variant="outline" className="text-[10px]">
                      {t}
                    </Badge>
                  ))}
                </div>
              ) : (
                "-"
              )}
            </Field>
          </dl>
        </CardContent>
      </Card>

      <Collapsible
        open={intelligenceOpen}
        onOpenChange={setIntelligenceOpen}
        className="lg:col-span-2"
      >
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Prospect intelligence & attribution</CardTitle>
            <CardAction>
              <CollapsibleTrigger
                render={
                  <Button type="button" variant="ghost" size="sm">
                    {intelligenceOpen ? "Collapse" : "View details"}
                    <ChevronDown
                      className={cn(
                        "h-3.5 w-3.5 transition-transform",
                        intelligenceOpen && "rotate-180",
                      )}
                    />
                  </Button>
                }
              />
            </CardAction>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="flex flex-wrap gap-2">
              <Badge
                variant="outline"
                className={cn(
                  "font-normal",
                  lead.prospectQualifyStatus === "completed" &&
                    "border-success/20 bg-success/10 text-success",
                  lead.prospectQualifyStatus === "incomplete" &&
                    "border-warning/20 bg-warning/10 text-warning",
                  lead.prospectQualifyStatus === "rejected" &&
                    "border-destructive/20 bg-destructive/10 text-destructive",
                )}
              >
                {humanizeValue(lead.prospectQualifyStatus)}
              </Badge>
              {lead.qualityScore != null ? (
                <Badge variant="secondary" className="font-normal tabular-nums">
                  Quality {lead.qualityScore}/100
                </Badge>
              ) : null}
              {lead.primaryOpportunityLabel || lead.primaryOpportunityId ? (
                <Badge variant="outline" className="max-w-full truncate font-normal">
                  {lead.primaryOpportunityLabel || lead.primaryOpportunityId}
                </Badge>
              ) : null}
              <Badge variant="secondary" className="font-normal tabular-nums">
                {lead.intentEvidence?.length ?? 0} evidence item
                {(lead.intentEvidence?.length ?? 0) === 1 ? "" : "s"}
              </Badge>
            </div>

            <CollapsibleContent className="mt-5 space-y-5">
              <dl className="divide-y">
            <Field label="Qualification status">
              {humanizeValue(lead.prospectQualifyStatus)}
            </Field>
            <Field label="Stored quality score">
              {lead.qualityScore != null ? `${lead.qualityScore}/100` : "-"}
            </Field>
            <Field label="Matched intent signals">
              {lead.qualitySignalCount != null ? lead.qualitySignalCount : "-"}
            </Field>
            <Field label="Primary opportunity">
              {lead.primaryOpportunityLabel || lead.primaryOpportunityId || "-"}
            </Field>
            <Field label="Deeply personalized">{lead.deeplyPersonalized ? "Yes" : "No"}</Field>
            <Field label="Rejection">
              {[lead.rejectionReason, lead.rejectionNote].filter(Boolean).join(" · ") || "-"}
            </Field>
              </dl>

              <section className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Structured personalization
              </p>
              {canEdit && onEditSection ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 gap-1 px-2 text-xs"
                  onClick={() => onEditSection("personalization")}
                >
                  <Pencil className="h-3.5 w-3.5" /> Edit
                </Button>
              ) : null}
            </div>
            <dl className="divide-y rounded-md border px-3">
              <Field label="Trigger">{lead.personalizationNote?.trigger || "-"}</Field>
              <Field label="Likely impact">{lead.personalizationNote?.likelyImpact || "-"}</Field>
              <Field label="Relevant service">{lead.personalizationNote?.relevantService || "-"}</Field>
              <Field label="Suggested angle">{lead.personalizationNote?.suggestedAngle || "-"}</Field>
            </dl>
              </section>

              <section className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Verified intent evidence
            </p>
            {lead.intentEvidence?.length ? (
              <div className="space-y-2">
                {lead.intentEvidence.map((evidence) => (
                  <div key={evidence.id} className="rounded-md border p-3 text-sm">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{evidence.label}</span>
                      <Badge variant="outline" className="text-[10px]">
                        {evidence.strength}
                      </Badge>
                      <Badge variant="secondary" className="text-[10px] font-normal">
                        {evidence.category}
                      </Badge>
                    </div>
                    <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                      {evidence.explanation || "No explanation"}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px]">
                      <span className="text-muted-foreground">{evidence.observedAt || "Date unknown"}</span>
                      {evidence.sourceUrl ? (
                        <ExternalValue href={evidence.sourceUrl}>View source</ExternalValue>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No structured evidence recorded.</p>
            )}
              </section>

              <section className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Strategy and buyer persona
            </p>
            <dl className="divide-y rounded-md border px-3">
              <Field label="Strategy">
                {strategy?.name || (lead.strategyId ? "Strategy unavailable" : "-")}
              </Field>
              <Field label="Strategy objective">{strategy?.objective || strategy?.description || "-"}</Field>
              <Field label="Strategy status/version">
                {strategy
                  ? `${strategy.status} · version ${lead.strategyVersion ?? strategy.version}`
                  : lead.strategyVersion != null
                    ? `Version ${lead.strategyVersion}`
                    : "-"}
              </Field>
              <Field label="Strategy mission">
                {strategy?.missionBlurb ? (
                  <MarkdownContent className="text-muted-foreground">
                    {strategy.missionBlurb}
                  </MarkdownContent>
                ) : (
                  "-"
                )}
              </Field>
              <Field label="Strategy research">
                {strategy?.researchNotes ? (
                  <MarkdownContent className="text-muted-foreground">
                    {strategy.researchNotes}
                  </MarkdownContent>
                ) : (
                  "-"
                )}
              </Field>
              <Field label="Strategy SOP">
                {strategy?.sopMarkdown ? (
                  <div className="max-h-96 overflow-y-auto pr-2">
                    <MarkdownContent>{strategy.sopMarkdown}</MarkdownContent>
                  </div>
                ) : (
                  "-"
                )}
              </Field>
              <Field label="Buyer persona">
                {persona?.name || (lead.personaId ? "Buyer persona unavailable" : "-")}
              </Field>
              <Field label="Persona description">{persona?.description || "-"}</Field>
              <Field label="Department/seniority">
                {[persona?.department, persona?.seniority].filter(Boolean).join(" · ") || "-"}
              </Field>
              <Field label="Responsibilities"><Values values={persona?.responsibilities} /></Field>
              <Field label="Business goals"><Values values={persona?.businessGoals} /></Field>
              <Field label="Persona pain points"><Values values={persona?.painPoints} /></Field>
              <Field label="Buying triggers"><Values values={persona?.buyingTriggers} /></Field>
              <Field label="Objections"><Values values={persona?.objections} /></Field>
              <Field label="Relevant services"><Values values={persona?.relevantServices} /></Field>
              <Field label="Recommended angle">{persona?.recommendedAngle || "-"}</Field>
              <Field label="Value proposition">{persona?.valueProposition || "-"}</Field>
              <Field label="Preferred CTA">{persona?.callToAction || "-"}</Field>
              <Field label="Assignment">
                {strategyAssignment
                  ? `${strategyAssignment.assignmentType} · ${strategyAssignment.allocationPct}% · ${strategyAssignment.status}`
                  : lead.strategyAssignmentId
                    ? "Assignment unavailable"
                    : "-"}
              </Field>
              <Field label="Assignment guidance">{strategyAssignment?.notes || "-"}</Field>
            </dl>
              </section>

              <section className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Outreach attribution
            </p>
            <dl className="divide-y rounded-md border px-3">
              <Field label="Campaign">
                {campaign?.name || (lead.campaignId ? "Campaign unavailable" : "-")}
              </Field>
              <Field label="Outreach profile">
                {profile?.name || (lead.profileId ? "Profile unavailable" : "-")}
              </Field>
              <Field label="Profile guidance">{profile?.notes || "-"}</Field>
              <Field label="Profile stack">{profile?.stackLabel || "-"}</Field>
              <Field label="Case study/script">{lead.caseStudyId ? "Assigned" : "-"}</Field>
              <Field label="Matched signals">
                {lead.qualityMatchedSignalIds?.length
                  ? `${lead.qualityMatchedSignalIds.length} matched`
                  : "-"}
              </Field>
            </dl>
              </section>

              {lead.extensions && Object.keys(lead.extensions).length > 0 ? (
                <section className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Channel-specific data
              </p>
              <pre className="max-h-64 overflow-auto rounded-md border bg-muted/30 p-3 text-xs whitespace-pre-wrap">
                {JSON.stringify(lead.extensions, null, 2)}
              </pre>
                </section>
              ) : null}
            </CollapsibleContent>
          </CardContent>
        </Card>
      </Collapsible>

      {/* Qualification */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Qualification</CardTitle>
          {canEdit && onEditSection ? (
            <CardAction>
              <Button type="button" variant="ghost" size="sm" onClick={() => onEditSection("qualification")}>
                <Pencil className="h-3.5 w-3.5" /> Edit
              </Button>
            </CardAction>
          ) : null}
        </CardHeader>
        <CardContent className="pt-0 space-y-3">
          <dl className="divide-y">
            <Field label="Temperature">
              <Badge variant="outline" className={cn("rounded-md", TEMPERATURE_TONE[lead.temperature].className)}>
                {TEMPERATURE_TONE[lead.temperature].label}
              </Badge>
            </Field>
            <Field label="Priority">
              <Badge className={cn("rounded-md border-transparent", PRIORITY_TONE[lead.priority].className)}>
                {PRIORITY_TONE[lead.priority].label}
              </Badge>
            </Field>
            <Field label="Estimated value">{fmtCurrency(lead.estimatedValue)}</Field>
            <Field label="Expected close">{lead.expectedCloseDate ? fmtDate(lead.expectedCloseDate) : "-"}</Field>
          </dl>
          {lead.bant && (
            <div className="space-y-2 pt-2">
              <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">BANT</div>
              {(["budget", "authority", "need", "timeline"] as const).map((k) => (
                <div key={k} className="flex items-center gap-3">
                  <span className="w-16 text-xs text-muted-foreground capitalize">{k}</span>
                  <Progress value={lead.bant![k] * 20} className="h-1.5 flex-1" />
                  <span className="text-xs tabular-nums w-6 text-right">{lead.bant![k]}/5</span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Campaign routing */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Campaign routing</CardTitle>
          {canEdit && onEditSection ? (
            <CardAction>
              <Button type="button" variant="ghost" size="sm" onClick={() => onEditSection("routing")}>
                <Pencil className="h-3.5 w-3.5" /> Edit
              </Button>
            </CardAction>
          ) : null}
        </CardHeader>
        <CardContent className="pt-0">
          <dl className="divide-y">
            {lead.campaignId?.trim() ? (
              <Field label="Instantly campaign">
                <LeadCampaignBadge lead={lead} link />
              </Field>
            ) : null}
            {lead.pushToInstantly && (
              <Field label="Push to Instantly">
                <Badge variant="outline" className={cn("rounded-md", PUSH_STATUS_TONE[lead.pushToInstantly].className)}>
                  {PUSH_STATUS_TONE[lead.pushToInstantly].label}
                </Badge>
              </Field>
            )}
            {lead.pushToLinkedIn && (
              <Field label="Push to LinkedIn">
                <Badge variant="outline" className={cn("rounded-md", PUSH_STATUS_TONE[lead.pushToLinkedIn].className)}>
                  {PUSH_STATUS_TONE[lead.pushToLinkedIn].label}
                </Badge>
              </Field>
            )}
            <Field label="Do not contact">
              <Badge
                variant="outline"
                className={
                  lead.doNotContact
                    ? "bg-destructive/10 text-destructive border-destructive/20"
                    : "bg-muted text-muted-foreground"
                }
              >
                {lead.doNotContact ? "Yes" : "No"}
              </Badge>
            </Field>
            {outreachProfileFieldLabel != null && outreachProfileSummary != null && (
              <Field label={outreachProfileFieldLabel}>
                <span>{outreachProfileSummary}</span>
              </Field>
            )}
          </dl>
        </CardContent>
      </Card>

      {/* Activity metrics */}
      <Card className="lg:col-span-2">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Activity metrics</CardTitle>
        </CardHeader>
        <CardContent className="pt-0 grid grid-cols-2 md:grid-cols-4 gap-4">
          <Metric label="Touches" value={lead.touches} />
          <Metric label="Last activity" value={fmtRelative(lead.lastActivityAt)} />
          <Metric
            label="Time to first outreach"
            value={responseTimeMinutes != null ? `${responseTimeMinutes}m` : "-"}
          />
          <Metric label="First contact" value={lead.firstContactAt ? fmtDate(lead.firstContactAt) : "-"} />
          <Metric label="Idle" value={lead.isIdle ? `Yes · ${lead.idleDays ?? 0} day(s)` : "No"} />
          <Metric label="Last reply" value={lead.lastReplyAt ? fmtDate(lead.lastReplyAt) : "-"} />
          <Metric
            label="Last auto-reply"
            value={lead.lastAutoReplyAt ? fmtDate(lead.lastAutoReplyAt) : "-"}
          />
          <Metric
            label="Follow up after"
            value={lead.followUpAfterDate ? lead.followUpAfterDate : "-"}
          />
          <Metric label="Reply source" value={lead.lastReplySource || "-"} />
          <Metric label="Created" value={fmtRelative(lead.createdAt)} />
        </CardContent>
      </Card>

      <Card className="lg:col-span-2">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Record linkage & lifecycle</CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          <dl className="divide-y">
            <Field label="Record type">
              {INTAKE_KIND_META[lead.intakeKind ?? "sales_lead"].label}
            </Field>
            <Field label="Company">{account?.name || lead.companyName || "-"}</Field>
            <Field label="Contact">{contact?.fullName || lead.contactName || "-"}</Field>
            <Field label="Prospect source">
              {sourceProspect
                ? `${sourceProspect.contactName} · ${sourceProspect.companyName}`
                : lead.prospectSourceId
                  ? "Source record unavailable"
                  : "-"}
            </Field>
            <Field label="Linked sales lead">
              {linkedSalesLead
                ? `${linkedSalesLead.contactName} · ${linkedSalesLead.companyName}`
                : lead.linkedSalesLeadId
                  ? "Linked lead unavailable"
                  : "-"}
            </Field>
            <Field label="Channels">
              <Values
                values={lead.channelTags?.map(
                  (channel) => CHANNELS[channel]?.label ?? humanizeValue(channel),
                )}
              />
            </Field>
            <Field label="Prospect visibility">
              {humanizeValue(lead.prospectVisibility)}
            </Field>
            <Field label="Prospect owner">
              {lead.prospectOwnerId ? (
                <UserChip userId={lead.prospectOwnerId} size="sm" />
              ) : (
                "-"
              )}
            </Field>
            <Field label="Created">{fmtDate(lead.createdAt, "MMM d, yyyy 'at' h:mm a")}</Field>
            <Field label="Updated">{fmtDate(lead.updatedAt, "MMM d, yyyy 'at' h:mm a")}</Field>
            <Field label="Quality scored">
              {fmtDate(lead.qualityScoredAt, "MMM d, yyyy 'at' h:mm a")}
            </Field>
            <Field label="Reply review">{humanizeValue(lead.replyReviewStatus)}</Field>
          </dl>
        </CardContent>
      </Card>

      {/* Next action / notes */}
      <Card className="lg:col-span-2">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Next action</CardTitle>
          {canEdit && onEditSection ? (
            <CardAction>
              <Button type="button" variant="ghost" size="sm" onClick={() => onEditSection("nextAction")}>
                <Pencil className="h-3.5 w-3.5" /> Edit
              </Button>
            </CardAction>
          ) : null}
        </CardHeader>
        <CardContent className="pt-0 space-y-2 text-sm">
          <p className="font-medium">{lead.nextAction ?? "-"}</p>
          {lead.notes && (
            <p className="text-muted-foreground border-l-2 pl-3">{lead.notes}</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-0.5 text-lg font-semibold tabular-nums">{value}</div>
    </div>
  );
}
