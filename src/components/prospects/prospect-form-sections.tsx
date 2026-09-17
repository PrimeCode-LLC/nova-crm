"use client";

import * as React from "react";
import { Controller, useFormContext, useWatch } from "react-hook-form";
import { CheckCircle2, ChevronDown, Loader2, ShieldCheck } from "lucide-react";
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
  normalizeOptionalHttpUrl,
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
import { prospectFieldAnchorId } from "@/lib/prospecting-strategy/qualify-field-focus";

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
  channelOptions: ChannelOption[];
  profiles: Profile[];
  strategies: ProspectingStrategy[];
  personasForStrategy: (strategyId: string) => BuyerPersona[];
  assignmentIdForStrategy?: (strategyId: string) => string;
  renderAnnotation?: (key: AnnotationKey) => React.ReactNode;
  /** When set (saved prospect), show Million Verifier control next to email status. */
  verifyLeadId?: string;
  /** Blocking qualify-gate messages keyed by issue code. Shown after submit. */
  fieldErrors?: Partial<Record<string, string>>;
};

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{children}</p>;
}

function Field({
  label,
  annotation,
  children,
  wide,
  error,
  fieldCode,
}: {
  label: string;
  annotation?: React.ReactNode;
  children: React.ReactNode;
  wide?: boolean;
  error?: string;
  fieldCode?: string;
}) {
  const anchorId = fieldCode ? prospectFieldAnchorId(fieldCode) : undefined;
  return (
    <div
      id={anchorId}
      data-prospect-field={fieldCode}
      className={cn("grid min-w-0 gap-1.5", wide && "sm:col-span-2")}
    >
      <div className="flex items-center justify-between gap-2">
        <Label>{label}</Label>
        {annotation}
      </div>
      {children}
      {error ? (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function UrlInput({
  name,
  ...props
}: React.ComponentProps<typeof Input> & {
  name: "website" | "companyLinkedin" | "careersUrl" | "linkedin";
}) {
  const { register, setValue } = useFormContext<ProspectFormValues>();
  const registration = register(name);
  return (
    <Input
      type="text"
      inputMode="url"
      autoComplete="url"
      {...props}
      {...registration}
      onBlur={(event) => {
        registration.onBlur(event);
        props.onBlur?.(event);
        const next = normalizeOptionalHttpUrl(event.target.value);
        if (next !== event.target.value) {
          setValue(name, next, { shouldDirty: true });
        }
      }}
    />
  );
}

function EnumSelect<T extends string>({
  name,
  options,
  invalid,
}: {
  name: keyof ProspectFormValues;
  options: Array<{ value: T; label: string }>;
  invalid?: boolean;
}) {
  const { control } = useFormContext<ProspectFormValues>();
  return (
    <Controller
      control={control}
      name={name}
      render={({ field }) => {
        const value = typeof field.value === "string" ? field.value : PROSPECT_FORM_UNSET;
        return (
          <Select value={value} onValueChange={(next) => next && field.onChange(next)}>
            <SelectTrigger aria-invalid={invalid || undefined}>
              <SelectValue placeholder="Not set">
                {value === PROSPECT_FORM_UNSET
                  ? "Not set"
                  : options.find((option) => option.value === value)?.label}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={PROSPECT_FORM_UNSET}>Not set</SelectItem>
              {options.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        );
      }}
    />
  );
}

export function ProspectFormSections({
  channelOptions,
  profiles,
  strategies,
  personasForStrategy,
  assignmentIdForStrategy,
  renderAnnotation,
  verifyLeadId,
  fieldErrors,
}: Props) {
  const { control, register, setValue, getValues } = useFormContext<ProspectFormValues>();
  const strategyId = useWatch({ control, name: "strategyId" });
  const channel = useWatch({ control, name: "channel" });
  const showAdvancedCompany = useWatch({ control, name: "showAdvancedCompany" });
  const [verifyingEmail, setVerifyingEmail] = React.useState(false);

  const selectedStrategy = strategies.find((strategy) => strategy.id === strategyId);
  const strategyPersonas = personasForStrategy(strategyId);
  const profileRequired = CHANNELS_REQUIRING_OUTREACH_PROFILE.includes(channel);
  const profileOptions = profiles.filter(
    (profile) => profile.active !== false && profile.channel === channel,
  );

  async function handleVerifyEmail() {
    const email = getValues("email").trim();
    if (!verifyLeadId || verifyingEmail) return;
    if (!email) {
      toast.error("Enter a company email before verifying.");
      return;
    }
    setVerifyingEmail(true);
    try {
      const { results, summary } = await verifyLeadEmailsClient([verifyLeadId]);
      const first = results[0];
      if (first?.error && !first.status) {
        toast.error(first.error);
        return;
      }
      if (first?.status) {
        setValue("emailVerify", first.status, { shouldDirty: true });
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
              <Controller
                control={control}
                name="strategyId"
                render={({ field }) => (
                  <Select
                    value={field.value || "__none__"}
                    onValueChange={(value) => {
                      const nextId = value === "__none__" ? "" : value ?? "";
                      field.onChange(nextId);
                      setValue("personaId", "", { shouldDirty: true });
                      setValue(
                        "strategyVersion",
                        strategies.find((item) => item.id === nextId)?.version,
                        { shouldDirty: true },
                      );
                      setValue(
                        "strategyAssignmentId",
                        nextId ? assignmentIdForStrategy?.(nextId) ?? "" : "",
                        { shouldDirty: true },
                      );
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue>{selectedStrategy?.name ?? "None"}</SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">None</SelectItem>
                      {strategies.map((strategy) => (
                        <SelectItem key={strategy.id} value={strategy.id}>
                          {strategy.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </Field>
            <Field label="Buyer persona">
              <Controller
                control={control}
                name="personaId"
                render={({ field }) => (
                  <Select
                    value={field.value || "__none__"}
                    onValueChange={(value) => field.onChange(value === "__none__" ? "" : value ?? "")}
                    disabled={!strategyId}
                  >
                    <SelectTrigger>
                      <SelectValue>
                        {strategyPersonas.find((persona) => persona.id === field.value)?.name ?? "None"}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">None</SelectItem>
                      {strategyPersonas.map((persona) => (
                        <SelectItem key={persona.id} value={persona.id}>
                          {persona.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
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
                    <span>
                      <span className="text-foreground">{item.label}</span> · {item.requirement}
                    </span>
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
            <Controller
              control={control}
              name="channel"
              render={({ field }) => (
                <Select
                  value={field.value}
                  onValueChange={(value) => {
                    if (!value) return;
                    field.onChange(value as ChannelKey);
                    setValue("profileId", "", { shouldDirty: true });
                  }}
                >
                  <SelectTrigger>
                    <SelectValue>
                      {channelOptions.find((option) => option.key === field.value)?.label ?? field.value}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {channelOptions.map((option) => (
                      <SelectItem key={option.key} value={option.key}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
          </Field>
          {profileRequired ? (
            <Field label={outreachProfileFieldLabel(channel)}>
              <Controller
                control={control}
                name="profileId"
                render={({ field }) => (
                  <Select value={field.value || undefined} onValueChange={(value) => field.onChange(value ?? "")}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select profile">
                        {profiles.find((profile) => profile.id === field.value)?.name}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {profileOptions.map((profile) => (
                        <SelectItem key={profile.id} value={profile.id}>
                          {profile.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </Field>
          ) : null}
          <Field label="Pipeline stage">
            <Controller
              control={control}
              name="stage"
              render={({ field }) => (
                <Select
                  value={field.value}
                  onValueChange={(value) => value && field.onChange(value as PipelineStage)}
                >
                  <SelectTrigger>
                    <SelectValue>
                      {PIPELINE_STAGES.find((item) => item.key === field.value)?.label}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {PIPELINE_STAGES.filter((item) => !item.isTerminal).map((item) => (
                      <SelectItem key={item.key} value={item.key}>
                        {item.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
          </Field>
          <Field label="Temperature">
            <Controller
              control={control}
              name="temperature"
              render={({ field }) => (
                <Select
                  value={field.value}
                  onValueChange={(value) => value && field.onChange(value as LeadTemperature)}
                >
                  <SelectTrigger>
                    <SelectValue>{TEMPERATURE_TONE[field.value].label}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(TEMPERATURE_TONE) as LeadTemperature[]).map((key) => (
                      <SelectItem key={key} value={key}>
                        {TEMPERATURE_TONE[key].label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
          </Field>
          <Field label="Priority">
            <Controller
              control={control}
              name="priority"
              render={({ field }) => (
                <Select
                  value={field.value}
                  onValueChange={(value) => value && field.onChange(value as LeadPriority)}
                >
                  <SelectTrigger>
                    <SelectValue>{PRIORITY_TONE[field.value].label}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(PRIORITY_TONE) as LeadPriority[]).map((key) => (
                      <SelectItem key={key} value={key}>
                        {PRIORITY_TONE[key].label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
          </Field>
          <Field label="Next action" wide>
            <Input {...register("nextAction")} />
          </Field>
          <Field label="Internal notes (lead)" annotation={renderAnnotation?.("notes")} wide>
            <Textarea {...register("leadNotes")} rows={2} />
          </Field>
        </div>
      </section>

      <Separator />

      <section className="space-y-3">
        <SectionTitle>Outreach readiness</SectionTitle>
        <div className="grid gap-3 sm:grid-cols-2 [&>*]:min-w-0">
          <Field label="Trigger event" annotation={renderAnnotation?.("triggerEvent")} wide>
            <Input {...register("triggerEvent")} />
          </Field>
          <Field label="Pain points" annotation={renderAnnotation?.("painPoints")} wide>
            <Textarea {...register("painPoints")} rows={2} />
          </Field>
          <Controller
            control={control}
            name="doNotContact"
            render={({ field }) => (
              <label className="flex items-start gap-3 rounded-md border p-3 sm:col-span-2">
                <Checkbox
                  checked={field.value}
                  onCheckedChange={(checked) => field.onChange(checked === true)}
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
            )}
          />
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
            onClick={() =>
              setValue("showAdvancedCompany", !getValues("showAdvancedCompany"), {
                shouldDirty: true,
              })
            }
          >
            {showAdvancedCompany ? "Hide" : "Show"} advanced research
            <ChevronDown className={cn("size-3.5 transition-transform", showAdvancedCompany && "rotate-180")} />
          </Button>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 [&>*]:min-w-0">
          <Field
            label="Business name"
            annotation={renderAnnotation?.("companyName")}
            wide
            fieldCode="company_name"
            error={fieldErrors?.company_name}
          >
            <Input
              required
              aria-invalid={Boolean(fieldErrors?.company_name)}
              {...register("bizName")}
            />
          </Field>
          <Field label="Industry" annotation={renderAnnotation?.("industry")}>
            <Input {...register("industry")} />
          </Field>
          <Field label="Business description" annotation={renderAnnotation?.("businessDescription")} wide>
            <Input {...register("bizDesc")} />
          </Field>
          <Field label="City" annotation={renderAnnotation?.("city")}>
            <Input {...register("city")} />
          </Field>
          <Field label="State / region" annotation={renderAnnotation?.("state")}>
            <Input {...register("state")} />
          </Field>
          <Field label="Country" annotation={renderAnnotation?.("country")}>
            <Input {...register("country")} />
          </Field>
          <Field
            label="Website URL"
            annotation={renderAnnotation?.("companyWebsite")}
            wide
            fieldCode="company_website"
            error={fieldErrors?.company_website}
          >
            <UrlInput
              name="website"
              placeholder="example.com or https://example.com"
              aria-invalid={Boolean(fieldErrors?.company_website)}
            />
          </Field>
          <Field label="Company LinkedIn URL" annotation={renderAnnotation?.("companyLinkedIn")} wide>
            <UrlInput name="companyLinkedin" placeholder="linkedin.com/company/…" />
          </Field>
          <div className={cn("contents", !showAdvancedCompany && "hidden")}>
            <Field label="Year founded" annotation={renderAnnotation?.("yearFounded")}>
              <Input {...register("yearFounded")} />
            </Field>
            <Field label="Business status">
              <EnumSelect name="bizStatus" options={BUSINESS_STATUS_OPTIONS} />
            </Field>
            <Field label="Company size" annotation={renderAnnotation?.("companySize")}>
              <EnumSelect
                name="size"
                options={COMPANY_SIZES.map((value) => ({ value, label: COMPANY_SIZE_LABELS[value] }))}
              />
            </Field>
            <Field label="Revenue range" annotation={renderAnnotation?.("revenueRange")}>
              <EnumSelect
                name="rev"
                options={(Object.keys(REVENUE_RANGES) as RevenueRange[]).map((value) => ({
                  value,
                  label: REVENUE_RANGES[value],
                }))}
              />
            </Field>
            <Field label="Website status">
              <EnumSelect name="webStatus" options={WEBSITE_STATUS_OPTIONS} />
            </Field>
            <Field label="Online activity score">
              <EnumSelect name="activity" options={ACTIVITY_OPTIONS} />
            </Field>
            <Field label="Last website activity">
              <Input type="date" {...register("lastSiteAt")} />
            </Field>
            <Field label="Last website observation" wide>
              <Textarea {...register("lastSiteNote")} rows={2} />
            </Field>
            <Field label="Tech stack / platform" annotation={renderAnnotation?.("techStack")} wide>
              <Input {...register("techStackStr")} />
            </Field>
            <Field label="Careers page URL" wide>
              <UrlInput name="careersUrl" placeholder="example.com/careers" />
            </Field>
          </div>
        </div>
      </section>

      <Separator />

      <section className="space-y-3">
        <SectionTitle>Contact</SectionTitle>
        <div className="grid gap-3 sm:grid-cols-2 [&>*]:min-w-0">
          <Field
            label="First name"
            annotation={renderAnnotation?.("firstName")}
            fieldCode="contact_name"
            error={fieldErrors?.contact_name}
          >
            <Input required aria-invalid={Boolean(fieldErrors?.contact_name)} {...register("firstName")} />
          </Field>
          <Field label="Last name" annotation={renderAnnotation?.("lastName")}>
            <Input required {...register("lastName")} />
          </Field>
          <Field
            label="Role / title"
            annotation={renderAnnotation?.("contactTitle")}
            wide
            fieldCode="contact_title"
            error={fieldErrors?.contact_title}
          >
            <Input aria-invalid={Boolean(fieldErrors?.contact_title)} {...register("title")} />
          </Field>
          <Field label="Seniority">
            <Input {...register("seniority")} />
          </Field>
          <Field label="Contact location">
            <Input {...register("contactLocation")} />
          </Field>
          <Field label="Primary email (company)" annotation={renderAnnotation?.("contactEmail")}>
            <Input type="email" {...register("email")} />
          </Field>
          <Field label="Personal email">
            <Input type="email" {...register("personalEmail")} />
          </Field>
          <Field
            label="Email verified"
            fieldCode="verified_email"
            error={fieldErrors?.verified_email}
          >
            <div className="flex items-center gap-2">
              <div className="min-w-0 flex-1">
                <EnumSelect
                  name="emailVerify"
                  options={EMAIL_OPTIONS}
                  invalid={Boolean(fieldErrors?.verified_email)}
                />
              </div>
              {verifyLeadId ? (
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
            <Input {...register("phone")} />
          </Field>
          <Field label="Contact source">
            <Input {...register("contactSource")} />
          </Field>
          <Field label="Best contact channel">
            <EnumSelect name="bestChannel" options={BEST_CHANNEL_OPTIONS} />
          </Field>
          <Field
            label="LinkedIn profile URL"
            annotation={renderAnnotation?.("contactLinkedIn")}
            wide
            fieldCode="contact_linkedin"
            error={fieldErrors?.contact_linkedin}
          >
            <UrlInput
              name="linkedin"
              placeholder="linkedin.com/in/…"
              aria-invalid={Boolean(fieldErrors?.contact_linkedin)}
            />
          </Field>
        </div>
      </section>

      <ProspectQualifyPanel fieldErrors={fieldErrors} />
    </div>
  );
}
