import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import type { Lead } from "@/lib/types";
import { PUSH_STATUS_TONE, TEMPERATURE_TONE, PRIORITY_TONE, REVENUE_RANGES } from "@/lib/constants";
import { fmtCurrency, fmtDate, fmtRelative } from "@/lib/format";
import { cn } from "@/lib/utils";
import { AlertTriangle } from "lucide-react";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[140px_1fr] gap-3 items-start py-2 border-b last:border-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm min-w-0">{children}</dd>
    </div>
  );
}

export function LeadOverview({ lead }: { lead: Lead }) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
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
                  className="bg-amber-500/10 text-amber-400 border-amber-500/20 gap-1"
                >
                  <AlertTriangle className="h-3 w-3" /> Required — fill before pushing
                </Badge>
              )}
            </Field>
            <Field label="Business focus">{lead.businessFocus ?? "—"}</Field>
            <Field label="Pain points">{lead.painPoints ?? "—"}</Field>
            <Field label="Recent news">{lead.recentNews ?? "—"}</Field>
            <Field label="Hiring signals">{lead.hiringSignals ?? "—"}</Field>
            <Field label="P.S. line">{lead.psLine ?? "—"}</Field>
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
                "—"
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
            <Field label="Expected close">{lead.expectedCloseDate ? fmtDate(lead.expectedCloseDate) : "—"}</Field>
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
                    ? "bg-rose-500/10 text-rose-400 border-rose-500/20"
                    : "bg-muted text-muted-foreground"
                }
              >
                {lead.doNotContact ? "Yes" : "No"}
              </Badge>
            </Field>
            <Field label="Company size">{lead.companySize ?? "—"}</Field>
            <Field label="Revenue range">
              {lead.revenueRange ? REVENUE_RANGES[lead.revenueRange] : "—"}
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
            value={lead.responseTimeMinutes ? `${lead.responseTimeMinutes}m` : "—"}
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
          <p className="font-medium">{lead.nextAction ?? "—"}</p>
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
