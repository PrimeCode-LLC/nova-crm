"use client";

import * as React from "react";
import { AlertTriangle, CheckCircle2, ChevronDown, Loader2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

import { ProspectQualifyPanel } from "@/components/prospecting/prospect-qualify-panel";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import type { ChannelOption } from "@/lib/channel-options";
import {
  CHANNELS_REQUIRING_OUTREACH_PROFILE,
  COMPANY_SIZES,
  COMPANY_SIZE_LABELS,
  PIPELINE_STAGES,
  PRIORITY_TONE,
  REVENUE_RANGES,
  TEMPERATURE_TONE,
  outreachProfileFieldLabel,
} from "@/lib/constants";
import type { BuyerPersona, ProspectingStrategy } from "@/lib/prospecting-strategy/types";
import {
  evaluateOutreachReadiness,
  PROSPECT_FORM_UNSET,
  type ProspectFormValues,
} from "@/lib/prospects/prospect-form";
import {
  formatVerifySummary,
  verifyLeadEmailsClient,
} from "@/lib/integrations/millionverifier/verify-client";
import type {
  BestContactChannel,
  BusinessStatus,
  ChannelKey,
  CompanySize,
  EmailVerificationStatus,
  LeadPriority,
  LeadTemperature,
  OnlineActivityScore,
  PipelineStage,
  Profile,
  RevenueRange,
  WebsiteStatus,
} from "@/lib/types";
import { cn } from "@/lib/utils";

const BUSINESS_STATUS_OPTIONS: Array<{ value: BusinessStatus; label: string }> = [
  { value: "active", label: "Active" },
  { value: "new", label: "New" },
  { value: "dormant", label: "Dormant" },
];
const WEBSITE_STATUS_OPTIONS: Array<{ value: WebsiteStatus; label: string }> = [
  { value: "live", label: "Live" },
  { value: "under_construction", label: "Under construction" },
  { value: "none", label: "No website" },
];
const ACTIVITY_OPTIONS: Array<{ value: OnlineActivityScore; label: string }> = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
];
const EMAIL_OPTIONS: Array<{ value: EmailVerificationStatus; label: string }> = [
  { value: "not_verified", label: "Not verified" },
  { value: "verified", label: "Verified" },
  { value: "bounced", label: "Invalid" },
  { value: "catch_all", label: "Risky (catch-all)" },
];
const BEST_CHANNEL_OPTIONS: Array<{ value: BestContactChannel; label: string }> = [
  { value: "email", label: "Email" },
  { value: "phone", label: "Phone" },
  { value: "linkedin", label: "LinkedIn" },
  { value: "form", label: "Website form" },
];

type AnnotationKey =
  | "companyName"
  | "companyWebsite"
  | "companyLinkedIn"
  | "industry"
  | "businessDescription"
  | "city"
  | "state"
  | "country"
  | "yearFounded"
  | "companySize"
  | "revenueRange"
  | "techStack"
  | "firstName"
  | "lastName"
  | "contactTitle"
  | "contactEmail"
  | "contactPhone"
  | "contactLinkedIn"
  | "triggerEvent"
  | "painPoints"
  | "notes";

type Props = {
  values: ProspectFormValues;
  onChange: (next: ProspectFormValues, changedKey?: AnnotationKey) => void;
  channelOptions: ChannelOption[];
  profiles: Profile[];
  strategies: ProspectingStrategy[];
  personas: BuyerPersona[];
  outreachThreshold: number;
  existingContactsForCompany: number;
  maxContactsPerCompany: number;
  renderAnnotation?: (key: AnnotationKey) => React.ReactNode;
  /** When set (saved prospect), show Million Verifier control next to email status. */
  verifyLeadId?: string;
};

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{children}</p>;
}

function Field({
  label,
  annotation,
  children,
  wide,
}: {
  label: string;
  annotation?: React.ReactNode;
  children: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <div className={cn("grid min-w-0 gap-1.5", wide && "sm:col-span-2")}>
      <div className="flex items-center justify-between gap-2">
        <Label>{label}</Label>
        {annotation}
      </div>
      {children}
    </div>
  );
}

export function ProspectFormSections({
  values,
  onChange,
  channelOptions,
  profiles,
  strategies,
  personas,
  outreachThreshold,
  existingContactsForCompany,
  maxContactsPerCompany,
  renderAnnotation,
  verifyLeadId,
}: Props) {
  const [verifyingEmail, setVerifyingEmail] = React.useState(false);
  const update = <K extends keyof ProspectFormValues>(
    key: K,
    value: ProspectFormValues[K],
    annotationKey?: AnnotationKey,
  ) => onChange({ ...values, [key]: value }, annotationKey);
  const selectedStrategy = strategies.find((strategy) => strategy.id === values.strategyId);
  const strategyPersonas = personas.filter((persona) => persona.active);
  const profileRequired = CHANNELS_REQUIRING_OUTREACH_PROFILE.includes(values.channel);
  const profileOptions = profiles.filter(
    (profile) => profile.active !== false && profile.channel === values.channel,
  );
  const readinessIssues = evaluateOutreachReadiness(values);

  async function handleVerifyEmail() {
    if (!verifyLeadId || !values.email.trim() || verifyingEmail) return;
    setVerifyingEmail(true);
    try {
      const { results, summary } = await verifyLeadEmailsClient([verifyLeadId]);
      const first = results[0];
      if (first?.error && !first.status) {
        toast.error(first.error);
        return;
      }
      if (first?.status) {
        update("emailVerify", first.status);
      }
      toast.success(formatVerifySummary(summary));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Email verification failed");
    } finally {
      setVerifyingEmail(false);
    }
  }

  return (
    <div className="space-y-6">
      {strategies.length ? (
        <section className="space-y-3">
          <SectionTitle>Strategy attribution</SectionTitle>
          <div className="grid gap-3 sm:grid-cols-2 [&>*]:min-w-0">
            <Field label="Prospecting strategy">
              <Select
                value={values.strategyId || "__none__"}
                onValueChange={(value) => {
                  const strategyId = value === "__none__" ? "" : value ?? "";
                  onChange({
                    ...values,
                    strategyId,
                    personaId: "",
                    strategyVersion: strategies.find((item) => item.id === strategyId)?.version,
                  });
                }}
              >
                <SelectTrigger><SelectValue>{selectedStrategy?.name ?? "None"}</SelectValue></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">None</SelectItem>
                  {strategies.map((strategy) => (
                    <SelectItem key={strategy.id} value={strategy.id}>{strategy.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Buyer persona">
              <Select
                value={values.personaId || "__none__"}
                onValueChange={(value) => update("personaId", value === "__none__" ? "" : value ?? "")}
                disabled={!values.strategyId}
              >
                <SelectTrigger>
                  <SelectValue>
                    {strategyPersonas.find((persona) => persona.id === values.personaId)?.name ?? "None"}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">None</SelectItem>
                  {strategyPersonas.map((persona) => (
                    <SelectItem key={persona.id} value={persona.id}>{persona.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>
          {selectedStrategy ? (
            <div className="space-y-1.5 rounded-md border bg-muted/30 px-3 py-2">
              <p className="text-xs font-medium">Quality checklist</p>
              {selectedStrategy.qualityChecklist
                .filter((item) => item.requirement !== "not_needed")
                .slice(0, 8)
                .map((item) => (
                  <div key={item.id} className="flex items-start gap-2 text-xs text-muted-foreground">
                    <CheckCircle2 className="mt-0.5 size-3.5 shrink-0" />
                    <span><span className="text-foreground">{item.label}</span> · {item.requirement}</span>
                  </div>
                ))}
            </div>
          ) : null}
        </section>
      ) : null}

      <section className="space-y-3">
        <SectionTitle>Intake defaults</SectionTitle>
        <div className="grid gap-3 sm:grid-cols-2 [&>*]:min-w-0">
          <Field label="Intended channel">
            <Select
              value={values.channel}
              onValueChange={(value) => {
                if (!value) return;
                onChange({ ...values, channel: value as ChannelKey, profileId: "" });
              }}
            >
              <SelectTrigger>
                <SelectValue>
                  {channelOptions.find((option) => option.key === values.channel)?.label ?? values.channel}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {channelOptions.map((option) => (
                  <SelectItem key={option.key} value={option.key}>{option.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          {profileRequired ? (
            <Field label={outreachProfileFieldLabel(values.channel)}>
              <Select value={values.profileId || undefined} onValueChange={(value) => update("profileId", value ?? "")}>
                <SelectTrigger>
                  <SelectValue placeholder="Select profile">
                    {profiles.find((profile) => profile.id === values.profileId)?.name}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {profileOptions.map((profile) => (
                    <SelectItem key={profile.id} value={profile.id}>{profile.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          ) : null}
          <Field label="Pipeline stage">
            <Select value={values.stage} onValueChange={(value) => value && update("stage", value as PipelineStage)}>
              <SelectTrigger><SelectValue>{PIPELINE_STAGES.find((item) => item.key === values.stage)?.label}</SelectValue></SelectTrigger>
              <SelectContent>
                {PIPELINE_STAGES.filter((item) => !item.isTerminal).map((item) => (
                  <SelectItem key={item.key} value={item.key}>{item.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Temperature">
            <Select value={values.temperature} onValueChange={(value) => value && update("temperature", value as LeadTemperature)}>
              <SelectTrigger><SelectValue>{TEMPERATURE_TONE[values.temperature].label}</SelectValue></SelectTrigger>
              <SelectContent>
                {(Object.keys(TEMPERATURE_TONE) as LeadTemperature[]).map((key) => (
                  <SelectItem key={key} value={key}>{TEMPERATURE_TONE[key].label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Priority">
            <Select value={values.priority} onValueChange={(value) => value && update("priority", value as LeadPriority)}>
              <SelectTrigger><SelectValue>{PRIORITY_TONE[values.priority].label}</SelectValue></SelectTrigger>
              <SelectContent>
                {(Object.keys(PRIORITY_TONE) as LeadPriority[]).map((key) => (
                  <SelectItem key={key} value={key}>{PRIORITY_TONE[key].label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Next action" wide>
            <Input value={values.nextAction} onChange={(event) => update("nextAction", event.target.value)} />
          </Field>
          <Field label="Internal notes (lead)" annotation={renderAnnotation?.("notes")} wide>
            <Textarea
              value={values.leadNotes}
              onChange={(event) => update("leadNotes", event.target.value, "notes")}
              rows={2}
            />
          </Field>
        </div>
      </section>

      <Separator />

      <section className="space-y-3">
        <SectionTitle>Outreach readiness</SectionTitle>
        <div className="grid gap-3 sm:grid-cols-2 [&>*]:min-w-0">
          <Field label="Trigger event" annotation={renderAnnotation?.("triggerEvent")} wide>
            <Input
              value={values.triggerEvent}
              onChange={(event) => update("triggerEvent", event.target.value, "triggerEvent")}
            />
          </Field>
          <Field label="Pain points" annotation={renderAnnotation?.("painPoints")} wide>
            <Textarea
              value={values.painPoints}
              onChange={(event) => update("painPoints", event.target.value, "painPoints")}
              rows={2}
            />
          </Field>
          <label className="flex items-start gap-3 rounded-md border p-3 sm:col-span-2">
            <Checkbox
              checked={values.doNotContact}
              onCheckedChange={(checked) => update("doNotContact", checked === true)}
              aria-label="Do not contact"
              className="mt-0.5"
            />
            <span>
              <span className="block text-sm font-medium">Do not contact</span>
              <span className="block text-xs text-muted-foreground">
                Prevent scheduling and channel push actions for this prospect.
              </span>
            </span>
          </label>
          <div
            className={cn(
              "flex items-start gap-2 rounded-md border px-3 py-2 text-xs sm:col-span-2",
              readinessIssues.length
                ? "border-warning/30 bg-warning/10 text-warning"
                : "border-success/30 bg-success/10 text-success",
            )}
          >
            {readinessIssues.length ? <AlertTriangle className="mt-0.5 size-3.5 shrink-0" /> : null}
            <span>{readinessIssues.length ? readinessIssues.join(" · ") : "Ready for outreach"}</span>
          </div>
        </div>
      </section>

      <Separator />

      <section className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <SectionTitle>Business</SectionTitle>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 text-xs"
            onClick={() => update("showAdvancedCompany", !values.showAdvancedCompany)}
          >
            {values.showAdvancedCompany ? "Hide" : "Show"} advanced research
            <ChevronDown className={cn("size-3.5 transition-transform", values.showAdvancedCompany && "rotate-180")} />
          </Button>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 [&>*]:min-w-0">
          <Field label="Business name" annotation={renderAnnotation?.("companyName")} wide>
            <Input required value={values.bizName} onChange={(event) => update("bizName", event.target.value, "companyName")} />
          </Field>
          <Field label="Industry" annotation={renderAnnotation?.("industry")}>
            <Input value={values.industry} onChange={(event) => update("industry", event.target.value, "industry")} />
          </Field>
          <Field label="Business description" annotation={renderAnnotation?.("businessDescription")} wide>
            <Input value={values.bizDesc} onChange={(event) => update("bizDesc", event.target.value, "businessDescription")} />
          </Field>
          <Field label="City" annotation={renderAnnotation?.("city")}>
            <Input value={values.city} onChange={(event) => update("city", event.target.value, "city")} />
          </Field>
          <Field label="State / region" annotation={renderAnnotation?.("state")}>
            <Input value={values.state} onChange={(event) => update("state", event.target.value, "state")} />
          </Field>
          <Field label="Country" annotation={renderAnnotation?.("country")}>
            <Input value={values.country} onChange={(event) => update("country", event.target.value, "country")} />
          </Field>
          <Field label="Website URL" annotation={renderAnnotation?.("companyWebsite")} wide>
            <Input type="url" value={values.website} onChange={(event) => update("website", event.target.value, "companyWebsite")} />
          </Field>
          <Field label="Company LinkedIn URL" annotation={renderAnnotation?.("companyLinkedIn")} wide>
            <Input type="url" value={values.companyLinkedin} onChange={(event) => update("companyLinkedin", event.target.value, "companyLinkedIn")} />
          </Field>
          <div className={cn("contents", !values.showAdvancedCompany && "hidden")}>
            <Field label="Year founded" annotation={renderAnnotation?.("yearFounded")}>
              <Input value={values.yearFounded} onChange={(event) => update("yearFounded", event.target.value, "yearFounded")} />
            </Field>
            <Field label="Business status">
              <SimpleSelect
                value={values.bizStatus}
                options={BUSINESS_STATUS_OPTIONS}
                onChange={(value) => update("bizStatus", value as ProspectFormValues["bizStatus"])}
              />
            </Field>
            <Field label="Company size" annotation={renderAnnotation?.("companySize")}>
              <SimpleSelect
                value={values.size}
                options={COMPANY_SIZES.map((value) => ({ value, label: COMPANY_SIZE_LABELS[value] }))}
                onChange={(value) => update("size", value as typeof PROSPECT_FORM_UNSET | CompanySize, "companySize")}
              />
            </Field>
            <Field label="Revenue range" annotation={renderAnnotation?.("revenueRange")}>
              <SimpleSelect
                value={values.rev}
                options={(Object.keys(REVENUE_RANGES) as RevenueRange[]).map((value) => ({ value, label: REVENUE_RANGES[value] }))}
                onChange={(value) => update("rev", value as typeof PROSPECT_FORM_UNSET | RevenueRange, "revenueRange")}
              />
            </Field>
            <Field label="Website status">
              <SimpleSelect value={values.webStatus} options={WEBSITE_STATUS_OPTIONS} onChange={(value) => update("webStatus", value as ProspectFormValues["webStatus"])} />
            </Field>
            <Field label="Online activity score">
              <SimpleSelect value={values.activity} options={ACTIVITY_OPTIONS} onChange={(value) => update("activity", value as ProspectFormValues["activity"])} />
            </Field>
            <Field label="Last website activity">
              <Input type="date" value={values.lastSiteAt} onChange={(event) => update("lastSiteAt", event.target.value)} />
            </Field>
            <Field label="Last website observation" wide>
              <Textarea value={values.lastSiteNote} onChange={(event) => update("lastSiteNote", event.target.value)} rows={2} />
            </Field>
            <Field label="Tech stack / platform" annotation={renderAnnotation?.("techStack")} wide>
              <Input value={values.techStackStr} onChange={(event) => update("techStackStr", event.target.value, "techStack")} />
            </Field>
            <Field label="Careers page URL" wide>
              <Input type="url" value={values.careersUrl} onChange={(event) => update("careersUrl", event.target.value)} />
            </Field>
          </div>
        </div>
      </section>

      <Separator />

      <section className="space-y-3">
        <SectionTitle>Contact</SectionTitle>
        <div className="grid gap-3 sm:grid-cols-2 [&>*]:min-w-0">
          <Field label="First name" annotation={renderAnnotation?.("firstName")}>
            <Input required value={values.firstName} onChange={(event) => update("firstName", event.target.value, "firstName")} />
          </Field>
          <Field label="Last name" annotation={renderAnnotation?.("lastName")}>
            <Input required value={values.lastName} onChange={(event) => update("lastName", event.target.value, "lastName")} />
          </Field>
          <Field label="Role / title" annotation={renderAnnotation?.("contactTitle")} wide>
            <Input value={values.title} onChange={(event) => update("title", event.target.value, "contactTitle")} />
          </Field>
          <Field label="Seniority">
            <Input value={values.seniority} onChange={(event) => update("seniority", event.target.value)} />
          </Field>
          <Field label="Contact location">
            <Input value={values.contactLocation} onChange={(event) => update("contactLocation", event.target.value)} />
          </Field>
          <Field label="Primary email (company)" annotation={renderAnnotation?.("contactEmail")}>
            <Input type="email" value={values.email} onChange={(event) => update("email", event.target.value, "contactEmail")} />
          </Field>
          <Field label="Personal email">
            <Input type="email" value={values.personalEmail} onChange={(event) => update("personalEmail", event.target.value)} />
          </Field>
          <Field label="Email verified">
            <div className="flex items-center gap-2">
              <div className="min-w-0 flex-1">
                <SimpleSelect
                  value={values.emailVerify}
                  options={EMAIL_OPTIONS}
                  onChange={(value) =>
                    update("emailVerify", value as ProspectFormValues["emailVerify"])
                  }
                />
              </div>
              {verifyLeadId && values.email.trim() ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="shrink-0"
                  disabled={verifyingEmail}
                  onClick={() => void handleVerifyEmail()}
                >
                  {verifyingEmail ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <ShieldCheck className="h-3.5 w-3.5" />
                  )}
                  Verify
                </Button>
              ) : null}
            </div>
          </Field>
          <Field label="Phone number" annotation={renderAnnotation?.("contactPhone")}>
            <Input value={values.phone} onChange={(event) => update("phone", event.target.value, "contactPhone")} />
          </Field>
          <Field label="Contact source">
            <Input value={values.contactSource} onChange={(event) => update("contactSource", event.target.value)} />
          </Field>
          <Field label="Best contact channel">
            <SimpleSelect value={values.bestChannel} options={BEST_CHANNEL_OPTIONS} onChange={(value) => update("bestChannel", value as ProspectFormValues["bestChannel"])} />
          </Field>
          <Field label="LinkedIn profile URL" annotation={renderAnnotation?.("contactLinkedIn")} wide>
            <Input type="url" value={values.linkedin} onChange={(event) => update("linkedin", event.target.value, "contactLinkedIn")} />
          </Field>
        </div>
      </section>

      <ProspectQualifyPanel
        state={values.qualifyForm}
        onChange={(qualifyForm) => update("qualifyForm", qualifyForm)}
        companyName={values.bizName}
        companyWebsite={values.website}
        contactName={`${values.firstName} ${values.lastName}`.trim()}
        contactTitle={values.title}
        contactLinkedIn={values.linkedin}
        emailVerified={values.emailVerify === "verified"}
        outreachThreshold={outreachThreshold}
        existingContactsForCompany={existingContactsForCompany}
        maxContactsPerCompany={maxContactsPerCompany}
      />
    </div>
  );
}

function SimpleSelect({
  value,
  options,
  onChange,
}: {
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
}) {
  return (
    <Select value={value} onValueChange={(next) => next && onChange(next)}>
      <SelectTrigger>
        <SelectValue placeholder="Not set">
          {value === PROSPECT_FORM_UNSET
            ? "Not set"
            : options.find((option) => option.value === value)?.label}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={PROSPECT_FORM_UNSET}>Not set</SelectItem>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
