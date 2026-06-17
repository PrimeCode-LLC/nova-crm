"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import type { Lead } from "@/lib/types";
import { PUSH_STATUS_TONE, TEMPERATURE_TONE, PRIORITY_TONE, REVENUE_RANGES } from "@/lib/constants";
import { fmtCurrency, fmtDate, fmtRelative } from "@/lib/format";
import { cn } from "@/lib/utils";
import { AlertTriangle } from "lucide-react";
import { UserChip } from "@/components/common/user-chip";
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

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[140px_1fr] gap-3 items-start py-2 border-b last:border-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm min-w-0">{children}</dd>
    </div>
  );
}

export function LeadOverview({
  lead,
  outreachProfileSummary,
  outreachProfileFieldLabel,
}: {
  lead: Lead;
  /** When set (Upwork / job apply), show which workspace profile this lead uses. */
  outreachProfileSummary?: string;
  outreachProfileFieldLabel?: string;
}) {
  const ws = useWorkspace();
  const emailResponseCtx = useLeadEmailResponseContext();
  const responseTimeMinutes = resolveLeadResponseTimeMinutes(lead, emailResponseCtx);
  const openQueue = !lead.ownerId?.trim();
  const scraperSource = getLeadScraperSource(lead);
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <Card className="lg:col-span-2">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Labels</CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          <EntityLabelPicker
            emphasizeAddAction
            labelIds={lead.labelIds ?? []}
            onChange={(next) => ws.patchLead(lead.id, { labelIds: next.length ? next : undefined })}
          />
        </CardContent>
      </Card>

      <Card className="lg:col-span-2">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Intake & ownership</CardTitle>
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

      {/* Qualification */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Qualification</CardTitle>
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
            <Field label="Company size">{lead.companySize ?? "-"}</Field>
            <Field label="Revenue range">
              {lead.revenueRange ? REVENUE_RANGES[lead.revenueRange] : "-"}
            </Field>
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
            label="Response time"
            value={responseTimeMinutes != null ? `${responseTimeMinutes}m` : "-"}
          />
          <Metric label="Created" value={fmtRelative(lead.createdAt)} />
        </CardContent>
      </Card>

      {/* Next action / notes */}
      <Card className="lg:col-span-2">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Next action</CardTitle>
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
