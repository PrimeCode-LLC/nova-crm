"use client";

import { useFieldArray, useFormContext, useWatch, Controller } from "react-hook-form";
import { Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  emptyEvidence,
  type ProspectQualifyStatus,
  type ProspectRejectionReason,
  PROSPECT_REJECTION_REASONS,
} from "@/lib/prospecting-strategy/qualify";
import type { ProspectFormValues } from "@/lib/prospects/prospect-form";
import { capitalizeSelectToken } from "@/lib/base-ui-select-label";
import { prospectFieldAnchorId } from "@/lib/prospecting-strategy/qualify-field-focus";
import { cn } from "@/lib/utils";

const SIGNAL_CATEGORIES = [
  "RFID / asset tracking",
  "Facility expansion",
  "WMS / TMS / ERP",
  "Vendor / RFP",
  "Inventory / visibility pain",
  "Hiring",
  "Leadership change",
  "Automation",
  "Acquisition / PE",
  "Fleet / network expansion",
  "Traceability / compliance",
  "Other",
];

export function ProspectQualifyPanel({
  fieldErrors,
}: {
  fieldErrors?: Partial<Record<string, string>>;
}) {
  const { control, register } = useFormContext<ProspectFormValues>();
  const { fields, append, remove } = useFieldArray({
    control,
    name: "qualifyForm.evidence",
    keyName: "fieldId",
  });
  const qualifyStatus = useWatch({ control, name: "qualifyForm.qualifyStatus" });

  return (
    <section className="space-y-4 rounded-md border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          Evidence & qualification
        </p>
        <p className="text-xs text-muted-foreground">Checked when you create the prospect.</p>
      </div>

      {(fieldErrors?.do_not_contact ||
        fieldErrors?.quality_score ||
        fieldErrors?.max_contacts) && (
        <div className="space-y-1">
          {fieldErrors.do_not_contact ? (
            <p
              id={prospectFieldAnchorId("do_not_contact")}
              data-prospect-field="do_not_contact"
              className="text-xs text-destructive"
              role="alert"
            >
              {fieldErrors.do_not_contact}
            </p>
          ) : null}
          {fieldErrors.quality_score ? (
            <p
              id={prospectFieldAnchorId("quality_score")}
              data-prospect-field="quality_score"
              className="text-xs text-destructive"
              role="alert"
            >
              {fieldErrors.quality_score}
            </p>
          ) : null}
          {fieldErrors.max_contacts ? (
            <p
              id={prospectFieldAnchorId("max_contacts")}
              data-prospect-field="max_contacts"
              className="text-xs text-destructive"
              role="alert"
            >
              {fieldErrors.max_contacts}
            </p>
          ) : null}
        </div>
      )}

      <div
        id={prospectFieldAnchorId("intent_evidence")}
        data-prospect-field="intent_evidence"
        className="space-y-3"
      >
        <div className="flex items-center justify-between gap-2">
          <Label className="text-sm">Intent evidence</Label>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => append(emptyEvidence())}
          >
            <Plus className="size-3.5" />
            Add signal
          </Button>
        </div>
        {fieldErrors?.intent_evidence ? (
          <p className="text-xs text-destructive" role="alert">
            {fieldErrors.intent_evidence}
          </p>
        ) : null}
        {fields.map((ev, idx) => (
          <div
            key={ev.fieldId}
            className={cn(
              "rounded-md border bg-muted/20 p-3 space-y-2",
              fieldErrors?.intent_evidence && "border-destructive/40",
            )}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium">Signal {idx + 1}</span>
              {fields.length > 1 ? (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-7 text-destructive"
                  onClick={() => remove(idx)}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              ) : null}
            </div>
            <div className="grid sm:grid-cols-2 gap-2 [&>*]:min-w-0">
              <div className="grid min-w-0 gap-1">
                <Label className="text-xs">Label</Label>
                <Input
                  placeholder="e.g. New distribution center in Texas"
                  {...register(`qualifyForm.evidence.${idx}.label`)}
                />
              </div>
              <div className="grid min-w-0 gap-1">
                <Label className="text-xs">Category</Label>
                <Controller
                  control={control}
                  name={`qualifyForm.evidence.${idx}.category`}
                  render={({ field }) => (
                    <Select
                      value={field.value || undefined}
                      onValueChange={(value) => field.onChange(value ?? "")}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Category">{field.value || "Category"}</SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        {SIGNAL_CATEGORIES.map((category) => (
                          <SelectItem key={category} value={category}>
                            {category}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                />
              </div>
              <div className="grid min-w-0 gap-1">
                <Label className="text-xs">Strength</Label>
                <Controller
                  control={control}
                  name={`qualifyForm.evidence.${idx}.strength`}
                  render={({ field }) => (
                    <Select
                      value={field.value}
                      onValueChange={(value) =>
                        field.onChange(value === "medium" ? "medium" : "strong")
                      }
                    >
                      <SelectTrigger>
                        <SelectValue>{capitalizeSelectToken(field.value)}</SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="strong">Strong</SelectItem>
                        <SelectItem value="medium">Medium</SelectItem>
                      </SelectContent>
                    </Select>
                  )}
                />
              </div>
              <div className="grid min-w-0 gap-1">
                <Label className="text-xs">Observed date</Label>
                <Controller
                  control={control}
                  name={`qualifyForm.evidence.${idx}.observedAt`}
                  render={({ field }) => (
                    <Input
                      type="date"
                      name={field.name}
                      ref={field.ref}
                      value={typeof field.value === "string" ? field.value.slice(0, 10) : ""}
                      onBlur={field.onBlur}
                      onChange={(event) => field.onChange(event.target.value)}
                    />
                  )}
                />
              </div>
              <div className="sm:col-span-2 grid min-w-0 gap-1">
                <Label className="text-xs">Evidence URL</Label>
                <Input
                  placeholder="https://…"
                  {...register(`qualifyForm.evidence.${idx}.sourceUrl`)}
                />
              </div>
              <div className="sm:col-span-2 grid min-w-0 gap-1">
                <Label className="text-xs">Explanation (your words)</Label>
                <Textarea
                  rows={2}
                  placeholder="Why this signal matters for Stellix Soft…"
                  {...register(`qualifyForm.evidence.${idx}.explanation`)}
                />
              </div>
            </div>
          </div>
        ))}
      </div>

      <div
        id={prospectFieldAnchorId("opportunity")}
        data-prospect-field="opportunity"
        className="space-y-2"
      >
        <Label className="text-sm">Primary opportunity</Label>
        <Input
          aria-invalid={Boolean(fieldErrors?.opportunity) || undefined}
          placeholder="e.g. RFID and IoT · WMS integrations · Operational dashboards"
          {...register("qualifyForm.primaryOpportunityLabel")}
        />
        {fieldErrors?.opportunity ? (
          <p className="text-xs text-destructive" role="alert">
            {fieldErrors.opportunity}
          </p>
        ) : null}
      </div>

      <div
        id={prospectFieldAnchorId("personalization")}
        data-prospect-field="personalization"
        className="space-y-2"
      >
        <Label className="text-sm">Personalization note</Label>
        {fieldErrors?.personalization ? (
          <p className="text-xs text-destructive" role="alert">
            {fieldErrors.personalization}
          </p>
        ) : null}
        <div className="grid gap-2">
          <div className="grid gap-1">
            <Label className="text-xs text-muted-foreground">Trigger</Label>
            <Textarea
              rows={2}
              placeholder="What recently happened?"
              aria-invalid={Boolean(fieldErrors?.personalization) || undefined}
              {...register("qualifyForm.personalization.trigger")}
            />
          </div>
          <div className="grid gap-1">
            <Label className="text-xs text-muted-foreground">Likely impact</Label>
            <Textarea
              rows={2}
              placeholder="What need does this create?"
              {...register("qualifyForm.personalization.likelyImpact")}
            />
          </div>
          <div className="grid gap-1">
            <Label className="text-xs text-muted-foreground">Relevant Stellix Soft service</Label>
            <Textarea
              rows={2}
              placeholder="e.g. Enterprise Application Development"
              {...register("qualifyForm.personalization.relevantService")}
            />
          </div>
          <div className="grid gap-1">
            <Label className="text-xs text-muted-foreground">Suggested outreach angle</Label>
            <Textarea
              rows={2}
              placeholder="How should outreach lead?"
              {...register("qualifyForm.personalization.suggestedAngle")}
            />
          </div>
        </div>
        <Controller
          control={control}
          name="qualifyForm.deeplyPersonalized"
          render={({ field }) => (
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={field.value}
                onCheckedChange={(checked) => field.onChange(checked === true)}
              />
              Deeply personalized (counts toward daily deep-personalization target)
            </label>
          )}
        />
      </div>

      <div className="grid sm:grid-cols-2 gap-2">
        <div className="grid gap-1">
          <Label className="text-xs">Save as</Label>
          <Controller
            control={control}
            name="qualifyForm.qualifyStatus"
            render={({ field }) => (
              <Select
                value={field.value}
                onValueChange={(value) =>
                  field.onChange((value as ProspectQualifyStatus) || "completed")
                }
              >
                <SelectTrigger>
                  <SelectValue>{capitalizeSelectToken(field.value)}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="completed">Completed (counts toward target)</SelectItem>
                  <SelectItem value="incomplete">Incomplete draft</SelectItem>
                  <SelectItem value="rejected">Rejected research</SelectItem>
                </SelectContent>
              </Select>
            )}
          />
        </div>
        {qualifyStatus === "rejected" ? (
          <div className="grid gap-1">
            <Label className="text-xs">Rejection reason</Label>
            <Controller
              control={control}
              name="qualifyForm.rejectionReason"
              render={({ field }) => (
                <Select
                  value={field.value || undefined}
                  onValueChange={(value) =>
                    field.onChange((value as ProspectRejectionReason) || "")
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select reason">
                      {PROSPECT_REJECTION_REASONS.find((reason) => reason.value === field.value)
                        ?.label ?? "Select reason"}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {PROSPECT_REJECTION_REASONS.map((reason) => (
                      <SelectItem key={reason.value} value={reason.value}>
                        {reason.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
          </div>
        ) : null}
      </div>
      {qualifyStatus === "rejected" ? (
        <Textarea
          rows={2}
          placeholder="Optional rejection note"
          {...register("qualifyForm.rejectionNote")}
        />
      ) : null}
    </section>
  );
}
