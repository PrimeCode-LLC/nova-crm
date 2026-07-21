"use client";

import * as React from "react";
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
import { Badge } from "@/components/ui/badge";
import {
  emptyEvidence,
  evaluateQualifyGate,
  formatPersonalizationNote,
  summarizeEvidenceMatch,
  type IntentEvidence,
  type ProspectQualifyStatus,
  type ProspectRejectionReason,
  PROSPECT_REJECTION_REASONS,
} from "@/lib/prospecting-strategy/qualify";
import {
  emptyProspectQualifyForm,
  type ProspectQualifyFormState,
} from "@/lib/prospects/prospect-form";
import { capitalizeSelectToken } from "@/lib/base-ui-select-label";

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

export function emptyQualifyFormState(): ProspectQualifyFormState {
  return emptyProspectQualifyForm();
}

export type { ProspectQualifyFormState } from "@/lib/prospects/prospect-form";

export function ProspectQualifyPanel({
  state,
  onChange,
  companyName,
  companyWebsite,
  contactName,
  contactTitle,
  contactLinkedIn,
  emailVerified,
  outreachThreshold,
  existingContactsForCompany,
  maxContactsPerCompany,
}: {
  state: ProspectQualifyFormState;
  onChange: (next: ProspectQualifyFormState) => void;
  companyName: string;
  companyWebsite: string;
  contactName: string;
  contactTitle: string;
  contactLinkedIn: string;
  emailVerified: boolean;
  outreachThreshold: number;
  existingContactsForCompany: number;
  maxContactsPerCompany: number;
}) {
  const gate = evaluateQualifyGate({
    companyName,
    companyWebsite,
    contactName,
    contactTitle,
    contactLinkedIn,
    emailVerified,
    intentEvidence: state.evidence,
    personalizationNote: state.personalization,
    primaryOpportunityLabel: state.primaryOpportunityLabel,
    outreachThreshold,
    existingContactsForCompany,
    maxContactsPerCompany,
  });

  const evidenceSummary = summarizeEvidenceMatch(state.evidence);

  const updateEvidence = (id: string, patch: Partial<IntentEvidence>) => {
    onChange({
      ...state,
      evidence: state.evidence.map((e) => (e.id === id ? { ...e, ...patch } : e)),
    });
  };

  const signalStatusLabel = (id: string) => {
    const status = evidenceSummary.statusById[id];
    if (status === "matched") return "Matched";
    if (status === "stale") return "Too old";
    if (status === "future") return "Future date";
    return "Incomplete";
  };

  return (
    <section className="space-y-4 rounded-md border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          Evidence & qualification
        </p>
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant={evidenceSummary.passes ? "default" : "outline"}>
            {evidenceSummary.matchLabel}
          </Badge>
          <Badge variant={gate.ok ? "default" : "secondary"}>
            {gate.ok ? "Ready to complete" : `${gate.issues.filter((i) => i.blocking).length} blockers`}
          </Badge>
        </div>
      </div>

      {gate.issues.length > 0 ? (
        <ul className="mb-3 space-y-1 text-xs">
          {gate.issues.map((issue) => (
            <li
              key={issue.code}
              className={issue.blocking ? "text-destructive" : "text-amber-600 dark:text-amber-400"}
            >
              {issue.blocking ? "• " : "⚠ "}
              {issue.message}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-muted-foreground">All qualify checks passed.</p>
      )}

      <div className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <Label className="text-sm">Intent evidence</Label>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() =>
              onChange({ ...state, evidence: [...state.evidence, emptyEvidence()] })
            }
          >
            <Plus className="size-3.5" />
            Add signal
          </Button>
        </div>
        {state.evidence.map((ev, idx) => (
          <div key={ev.id} className="rounded-md border bg-muted/20 p-3 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-2">
                <span className="text-xs font-medium">Signal {idx + 1}</span>
                <Badge
                  variant={evidenceSummary.statusById[ev.id] === "matched" ? "default" : "outline"}
                  className="text-[10px]"
                >
                  {signalStatusLabel(ev.id)}
                </Badge>
              </div>
              {state.evidence.length > 1 ? (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-7 text-destructive"
                  onClick={() =>
                    onChange({
                      ...state,
                      evidence: state.evidence.filter((e) => e.id !== ev.id),
                    })
                  }
                >
                  <Trash2 className="size-3.5" />
                </Button>
              ) : null}
            </div>
            <div className="grid sm:grid-cols-2 gap-2 [&>*]:min-w-0">
              <div className="grid min-w-0 gap-1">
                <Label className="text-xs">Label</Label>
                <Input
                  value={ev.label}
                  placeholder="e.g. New distribution center in Texas"
                  onChange={(e) => updateEvidence(ev.id, { label: e.target.value })}
                />
              </div>
              <div className="grid min-w-0 gap-1">
                <Label className="text-xs">Category</Label>
                <Select
                  value={ev.category || undefined}
                  onValueChange={(v) => updateEvidence(ev.id, { category: v ?? "" })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Category">{ev.category || "Category"}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {SIGNAL_CATEGORIES.map((c) => (
                      <SelectItem key={c} value={c}>
                        {c}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid min-w-0 gap-1">
                <Label className="text-xs">Strength</Label>
                <Select
                  value={ev.strength}
                  onValueChange={(v) =>
                    updateEvidence(ev.id, {
                      strength: v === "medium" ? "medium" : "strong",
                    })
                  }
                >
                  <SelectTrigger>
                    <SelectValue>{capitalizeSelectToken(ev.strength)}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="strong">Strong</SelectItem>
                    <SelectItem value="medium">Medium</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid min-w-0 gap-1">
                <Label className="text-xs">Observed date</Label>
                <Input
                  type="date"
                  value={ev.observedAt.slice(0, 10)}
                  onChange={(e) => updateEvidence(ev.id, { observedAt: e.target.value })}
                />
              </div>
              <div className="sm:col-span-2 grid min-w-0 gap-1">
                <Label className="text-xs">Evidence URL</Label>
                <Input
                  value={ev.sourceUrl}
                  placeholder="https://…"
                  onChange={(e) => updateEvidence(ev.id, { sourceUrl: e.target.value })}
                />
              </div>
              <div className="sm:col-span-2 grid min-w-0 gap-1">
                <Label className="text-xs">Explanation (your words)</Label>
                <Textarea
                  rows={2}
                  value={ev.explanation}
                  placeholder="Why this signal matters for Stellix Soft…"
                  onChange={(e) => updateEvidence(ev.id, { explanation: e.target.value })}
                />
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="space-y-2">
        <Label className="text-sm">Primary opportunity</Label>
        <Input
          value={state.primaryOpportunityLabel}
          placeholder="e.g. RFID and IoT · WMS integrations · Operational dashboards"
          onChange={(e) => onChange({ ...state, primaryOpportunityLabel: e.target.value })}
        />
      </div>

      <div className="space-y-2">
        <Label className="text-sm">Personalization note</Label>
        <div className="grid gap-2">
          <div className="grid gap-1">
            <Label className="text-xs text-muted-foreground">Trigger</Label>
            <Textarea
              rows={2}
              placeholder="What recently happened?"
              value={state.personalization.trigger}
              onChange={(e) =>
                onChange({
                  ...state,
                  personalization: { ...state.personalization, trigger: e.target.value },
                })
              }
            />
          </div>
          <div className="grid gap-1">
            <Label className="text-xs text-muted-foreground">Likely impact</Label>
            <Textarea
              rows={2}
              placeholder="What need does this create?"
              value={state.personalization.likelyImpact}
              onChange={(e) =>
                onChange({
                  ...state,
                  personalization: { ...state.personalization, likelyImpact: e.target.value },
                })
              }
            />
          </div>
          <div className="grid gap-1">
            <Label className="text-xs text-muted-foreground">Relevant Stellix Soft service</Label>
            <Textarea
              rows={2}
              placeholder="e.g. Enterprise Application Development"
              value={state.personalization.relevantService}
              onChange={(e) =>
                onChange({
                  ...state,
                  personalization: { ...state.personalization, relevantService: e.target.value },
                })
              }
            />
          </div>
          <div className="grid gap-1">
            <Label className="text-xs text-muted-foreground">Suggested outreach angle</Label>
            <Textarea
              rows={2}
              placeholder="How should outreach lead?"
              value={state.personalization.suggestedAngle}
              onChange={(e) =>
                onChange({
                  ...state,
                  personalization: { ...state.personalization, suggestedAngle: e.target.value },
                })
              }
            />
          </div>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <Checkbox
            checked={state.deeplyPersonalized}
            onCheckedChange={(v) => onChange({ ...state, deeplyPersonalized: Boolean(v) })}
          />
          Deeply personalized (counts toward daily deep-personalization target)
        </label>
      </div>

      <div className="grid sm:grid-cols-2 gap-2">
        <div className="grid gap-1">
          <Label className="text-xs">Save as</Label>
          <Select
            value={state.qualifyStatus}
            onValueChange={(v) =>
              onChange({
                ...state,
                qualifyStatus: (v as ProspectQualifyStatus) || "completed",
              })
            }
          >
            <SelectTrigger>
              <SelectValue>{capitalizeSelectToken(state.qualifyStatus)}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="completed">Completed (counts toward target)</SelectItem>
              <SelectItem value="incomplete">Incomplete draft</SelectItem>
              <SelectItem value="rejected">Rejected research</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {state.qualifyStatus === "rejected" ? (
          <div className="grid gap-1">
            <Label className="text-xs">Rejection reason</Label>
            <Select
              value={state.rejectionReason || undefined}
              onValueChange={(v) =>
                onChange({
                  ...state,
                  rejectionReason: (v as ProspectRejectionReason) || "",
                })
              }
            >
              <SelectTrigger>
                <SelectValue placeholder="Select reason">
                  {PROSPECT_REJECTION_REASONS.find((r) => r.value === state.rejectionReason)
                    ?.label ?? "Select reason"}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {PROSPECT_REJECTION_REASONS.map((r) => (
                  <SelectItem key={r.value} value={r.value}>
                    {r.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : null}
      </div>
      {state.qualifyStatus === "rejected" ? (
        <Textarea
          rows={2}
          placeholder="Optional rejection note"
          value={state.rejectionNote}
          onChange={(e) => onChange({ ...state, rejectionNote: e.target.value })}
        />
      ) : null}

      <p className="text-[11px] text-muted-foreground whitespace-pre-wrap border-t pt-2">
        Preview:{"\n"}
        {formatPersonalizationNote(state.personalization) || "(personalization empty)"}
      </p>
    </section>
  );
}
