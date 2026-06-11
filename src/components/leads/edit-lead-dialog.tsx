"use client";

import * as React from "react";
import { toast } from "sonner";
import type {
  Lead,
  LeadPriority,
  LeadTemperature,
  PipelineStage,
  CompanySize,
  RevenueRange,
  PushStatus,
  BANT,
  ChannelKey,
  LeadIntakeKind,
} from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  PIPELINE_STAGES,
  CHANNEL_LIST,
  CHANNELS_REQUIRING_OUTREACH_PROFILE,
  outreachProfileFieldLabel,
  TEMPERATURE_TONE,
  PRIORITY_TONE,
  REVENUE_RANGES,
  COMPANY_SIZES,
  COMPANY_SIZE_LABELS,
  PUSH_STATUS_TONE,
  INTAKE_KIND_META,
} from "@/lib/constants";
import { selectTriggerLabelByKey } from "@/lib/base-ui-select-label";
import { useWorkspace } from "@/components/providers/workspace-mode-provider";
import { AddToCampaignDialog } from "@/components/outreach/add-to-campaign-dialog";
import { buildWorkspaceOwnerPickerOptions } from "@/lib/owner-scope";
import { EntityLabelPicker } from "@/components/crm/entity-label-picker";

const UNSET = "__unset__" as const;
type UnsetToken = typeof UNSET;

function isoFromDateInput(dateStr: string): string | undefined {
  if (!dateStr.trim()) return undefined;
  const d = new Date(`${dateStr}T12:00:00`);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

function dateInputFromIso(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function parseToolsUsed(raw: string): string[] | undefined {
  const parts = raw
    .split(/[,;\n]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const uniq = [...new Set(parts)];
  return uniq.length ? uniq : undefined;
}

function toolsUsedToString(tools?: string[]): string {
  return tools?.length ? tools.join(", ") : "";
}

function clampBant(n: number): number {
  return Math.min(5, Math.max(1, Math.round(n)));
}

const PUSH_KEYS = Object.keys(PUSH_STATUS_TONE) as PushStatus[];
const REVENUE_KEYS = Object.keys(REVENUE_RANGES) as RevenueRange[];

export function EditLeadDialog({
  open,
  onOpenChange,
  lead,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  lead: Lead | null;
  onSave: (patch: Partial<Lead>) => void;
}) {
  const [channel, setChannel] = React.useState<ChannelKey>("cold_email");
  const [stage, setStage] = React.useState<PipelineStage>("new");
  const [temperature, setTemperature] = React.useState<LeadTemperature>("cold");
  const [priority, setPriority] = React.useState<LeadPriority>("medium");
  const [nextAction, setNextAction] = React.useState("");
  const [notes, setNotes] = React.useState("");
  const [estimatedValue, setEstimatedValue] = React.useState("");
  const [expectedClose, setExpectedClose] = React.useState("");

  const [triggerEvent, setTriggerEvent] = React.useState("");
  const [businessFocus, setBusinessFocus] = React.useState("");
  const [painPoints, setPainPoints] = React.useState("");
  const [recentNews, setRecentNews] = React.useState("");
  const [hiringSignals, setHiringSignals] = React.useState("");
  const [psLine, setPsLine] = React.useState("");
  const [toolsUsedStr, setToolsUsedStr] = React.useState("");

  const [doNotContact, setDoNotContact] = React.useState(false);
  const [companySize, setCompanySize] = React.useState<CompanySize | UnsetToken>(UNSET);
  const [revenueRange, setRevenueRange] = React.useState<RevenueRange | UnsetToken>(UNSET);
  const [pushToInstantly, setPushToInstantly] = React.useState<PushStatus | UnsetToken>(UNSET);
  const [pushToLinkedIn, setPushToLinkedIn] = React.useState<PushStatus | UnsetToken>(UNSET);
  const [campaignDialogOpen, setCampaignDialogOpen] = React.useState(false);

  const [useBant, setUseBant] = React.useState(false);
  const [bantBudget, setBantBudget] = React.useState("3");
  const [bantAuthority, setBantAuthority] = React.useState("3");
  const [bantNeed, setBantNeed] = React.useState("3");
  const [bantTimeline, setBantTimeline] = React.useState("3");

  const [profileId, setProfileId] = React.useState("");
  const [intakeKind, setIntakeKind] = React.useState<LeadIntakeKind>("sales_lead");
  const [scraperId, setScraperId] = React.useState<string | UnsetToken>(UNSET);
  const [labelIds, setLabelIds] = React.useState<string[]>([]);
  const { profiles, users, currentUserId, getOwnerDisplayName, canEditLead } = useWorkspace();

  const ownerPickerIds = React.useMemo(() => {
    const ids = new Set<string>();
    if (lead?.ownerId) ids.add(lead.ownerId);
    if (lead?.scraperId) ids.add(lead.scraperId);
    return [...ids];
  }, [lead?.ownerId, lead?.scraperId]);

  const scraperOptions = React.useMemo(
    () => buildWorkspaceOwnerPickerOptions(users, currentUserId, getOwnerDisplayName, ownerPickerIds),
    [users, currentUserId, getOwnerDisplayName, ownerPickerIds],
  );

  const profileOptionsForChannel = React.useMemo(
    () => profiles.filter((p) => p.channel === channel && p.active !== false),
    [profiles, channel],
  );

  React.useEffect(() => {
    if (!open || !lead) return;
    React.startTransition(() => {
      setChannel(lead.channel);
      setStage(lead.stage);
      setTemperature(lead.temperature);
      setPriority(lead.priority);
      setNextAction(lead.nextAction ?? "");
      setNotes(lead.notes ?? "");
      setEstimatedValue(lead.estimatedValue != null ? String(lead.estimatedValue) : "");
      setExpectedClose(dateInputFromIso(lead.expectedCloseDate));

      setTriggerEvent(lead.triggerEvent ?? "");
      setBusinessFocus(lead.businessFocus ?? "");
      setPainPoints(lead.painPoints ?? "");
      setRecentNews(lead.recentNews ?? "");
      setHiringSignals(lead.hiringSignals ?? "");
      setPsLine(lead.psLine ?? "");
      setToolsUsedStr(toolsUsedToString(lead.toolsUsed));

      setDoNotContact(!!lead.doNotContact);
      setCompanySize(lead.companySize ?? UNSET);
      setRevenueRange(lead.revenueRange ?? UNSET);
      setPushToInstantly(lead.pushToInstantly ?? UNSET);
      setPushToLinkedIn(lead.pushToLinkedIn ?? UNSET);

      const b = lead.bant;
      setUseBant(!!b);
      setBantBudget(String(b?.budget ?? 3));
      setBantAuthority(String(b?.authority ?? 3));
      setBantNeed(String(b?.need ?? 3));
      setBantTimeline(String(b?.timeline ?? 3));

      const ch = lead.channel;
      if (CHANNELS_REQUIRING_OUTREACH_PROFILE.includes(ch)) {
        const opts = profiles.filter((p) => p.channel === ch && p.active !== false);
        const want = lead.profileId?.trim() ?? "";
        if (want && opts.some((p) => p.id === want)) {
          setProfileId(want);
        } else if (opts.length === 1) {
          setProfileId(opts[0]!.id);
        } else {
          setProfileId("");
        }
      } else {
        setProfileId("");
      }

      setIntakeKind(lead.intakeKind ?? "sales_lead");
      const existingScraper = lead.scraperId?.trim();
      const me = currentUserId?.trim();
      setScraperId(existingScraper || (me ? me : UNSET));
      setLabelIds(lead.labelIds ?? []);
    });
  }, [open, lead, profiles, currentUserId]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!lead) return;
    if (CHANNELS_REQUIRING_OUTREACH_PROFILE.includes(channel)) {
      const opts = profiles.filter((p) => p.channel === channel && p.active !== false);
      if (opts.length > 0 && !profileId.trim()) {
        toast.error(
          channel === "upwork" ? "Select an Upwork profile." : "Select a CV / apply profile.",
        );
        return;
      }
    }
    const evRaw = estimatedValue.trim();
    let estimatedValueNum: number | undefined;
    if (evRaw) {
      const n = Number(evRaw.replace(/,/g, ""));
      if (!Number.isFinite(n) || n < 0) {
        toast.error("Estimated value must be a valid number.");
        return;
      }
      estimatedValueNum = n;
    } else {
      estimatedValueNum = undefined;
    }
    const expectedCloseDate = isoFromDateInput(expectedClose);

    let bant: BANT | undefined;
    if (useBant) {
      bant = {
        budget: clampBant(Number(bantBudget)),
        authority: clampBant(Number(bantAuthority)),
        need: clampBant(Number(bantNeed)),
        timeline: clampBant(Number(bantTimeline)),
      };
    }

    const profileIdTrim = profileId.trim();
    const profilePatch: Partial<Lead> = CHANNELS_REQUIRING_OUTREACH_PROFILE.includes(channel)
      ? { profileId: profileIdTrim || undefined }
      : { profileId: undefined };

    onSave({
      ...profilePatch,
      intakeKind: intakeKind === "sales_lead" ? undefined : "prospect",
      scraperId: scraperId === UNSET ? undefined : scraperId,
      channel,
      stage,
      temperature,
      priority,
      nextAction: nextAction.trim() || undefined,
      notes: notes.trim() || undefined,
      estimatedValue: estimatedValueNum,
      expectedCloseDate,

      triggerEvent: triggerEvent.trim() || undefined,
      businessFocus: businessFocus.trim() || undefined,
      painPoints: painPoints.trim() || undefined,
      recentNews: recentNews.trim() || undefined,
      hiringSignals: hiringSignals.trim() || undefined,
      psLine: psLine.trim() || undefined,
      toolsUsed: parseToolsUsed(toolsUsedStr),

      doNotContact,
      companySize: companySize === UNSET ? undefined : companySize,
      revenueRange: revenueRange === UNSET ? undefined : revenueRange,
      pushToInstantly: pushToInstantly === UNSET ? undefined : pushToInstantly,
      pushToLinkedIn: pushToLinkedIn === UNSET ? undefined : pushToLinkedIn,

      bant,
      labelIds: labelIds.length ? labelIds : undefined,
    });
    toast.success("Lead updated");
    onOpenChange(false);
  }

  if (!lead) return null;
  const readOnly = !canEditLead(lead);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl" showCloseButton>
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Edit lead</DialogTitle>
            <DialogDescription>
            {readOnly ? "This lead was created from a prospect push. Only workspace admins can edit it." : null}
              Update research, routing, qualification, and next steps for {lead.contactName}. Changes apply for this
              browser session.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2 max-h-[min(78vh,640px)] overflow-y-auto pr-1">
            <section className="space-y-3">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                Intake & attribution
              </p>
              <div className="grid sm:grid-cols-2 gap-3">
                <div className="grid gap-2">
                  <Label>Record type</Label>
                  <Select
                    value={intakeKind}
                    onValueChange={(v) => v && setIntakeKind(v as LeadIntakeKind)}
                  >
                    <SelectTrigger>
                      <SelectValue>
                        {INTAKE_KIND_META[intakeKind]?.label ?? undefined}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="prospect">{INTAKE_KIND_META.prospect.label}</SelectItem>
                      <SelectItem value="sales_lead">{INTAKE_KIND_META.sales_lead.label}</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-[11px] text-muted-foreground">
                    Prospects are top-of-funnel intake; promote when the contact shows real interest.
                  </p>
                </div>
                <div className="grid gap-2">
                  <Label>Lead by (sourced by)</Label>
                  <Select
                    value={scraperId}
                    onValueChange={(v) => v && setScraperId(v as string | UnsetToken)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Not set">
                        {scraperId === UNSET
                          ? undefined
                          : scraperOptions.find((o) => o.id === scraperId)?.label}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={UNSET}>Not set</SelectItem>
                      {scraperOptions.map((o) => (
                        <SelectItem key={o.id} value={o.id}>
                          {o.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </section>

            <Separator />

            <section className="space-y-3">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Labels</p>
              <EntityLabelPicker emphasizeAddAction labelIds={labelIds} onChange={setLabelIds} />
            </section>

            <Separator />

            <section className="space-y-3">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                Research & personalization
              </p>
              <div className="grid gap-2">
                <Label htmlFor="edit-trigger">Trigger event</Label>
                <Textarea
                  id="edit-trigger"
                  value={triggerEvent}
                  onChange={(e) => setTriggerEvent(e.target.value)}
                  rows={2}
                  className="resize-none"
                  placeholder="Why reach out now?"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="edit-focus">Business focus</Label>
                <Textarea
                  id="edit-focus"
                  value={businessFocus}
                  onChange={(e) => setBusinessFocus(e.target.value)}
                  rows={2}
                  className="resize-none"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="edit-pain">Pain points</Label>
                <Textarea
                  id="edit-pain"
                  value={painPoints}
                  onChange={(e) => setPainPoints(e.target.value)}
                  rows={2}
                  className="resize-none"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="edit-news">Recent news</Label>
                <Textarea
                  id="edit-news"
                  value={recentNews}
                  onChange={(e) => setRecentNews(e.target.value)}
                  rows={2}
                  className="resize-none"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="edit-hiring">Hiring signals</Label>
                <Textarea
                  id="edit-hiring"
                  value={hiringSignals}
                  onChange={(e) => setHiringSignals(e.target.value)}
                  rows={2}
                  className="resize-none"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="edit-ps">P.S. line</Label>
                <Input id="edit-ps" value={psLine} onChange={(e) => setPsLine(e.target.value)} />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="edit-tools">Tools used</Label>
                <Input
                  id="edit-tools"
                  value={toolsUsedStr}
                  onChange={(e) => setToolsUsedStr(e.target.value)}
                  placeholder="Comma-separated, e.g. Salesforce, HubSpot"
                />
              </div>
            </section>

            <Separator />

            <section className="space-y-3">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Campaign routing</p>
              <div className="grid gap-2">
                <Label>Channel</Label>
                <Select
                  value={channel}
                  onValueChange={(v) => {
                    if (!v) return;
                    const ch = v as ChannelKey;
                    setChannel(ch);
                    if (!CHANNELS_REQUIRING_OUTREACH_PROFILE.includes(ch)) {
                      setProfileId("");
                      return;
                    }
                    const opts = profiles.filter((p) => p.channel === ch && p.active !== false);
                    setProfileId(opts.length === 1 ? opts[0]!.id : "");
                  }}
                >
                  <SelectTrigger>
                    <SelectValue>{selectTriggerLabelByKey(channel, CHANNEL_LIST) ?? undefined}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {CHANNEL_LIST.map((c) => (
                      <SelectItem key={c.key} value={c.key}>
                        {c.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {CHANNELS_REQUIRING_OUTREACH_PROFILE.includes(channel) && (
                <div className="grid gap-2">
                  <Label>{outreachProfileFieldLabel(channel)}</Label>
                  {profileOptionsForChannel.length === 0 ? (
                    <p className="text-xs text-muted-foreground">
                      No active profiles for this channel. Add one under Admin → Profiles.
                    </p>
                  ) : (
                    <Select
                      value={profileId}
                      onValueChange={(v) => {
                        if (v != null) setProfileId(v);
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select profile">
                          {profileOptionsForChannel.find((p) => p.id === profileId)?.name ?? undefined}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        {profileOptionsForChannel.map((p) => (
                          <SelectItem key={p.id} value={p.id}>
                            {p.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </div>
              )}
              <div className="flex items-center gap-2">
                <Checkbox
                  id="edit-dnc"
                  checked={doNotContact}
                  onCheckedChange={(v) => setDoNotContact(v === true)}
                />
                <Label htmlFor="edit-dnc" className="font-normal cursor-pointer">
                  Do not contact
                </Label>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-2">
                  <Label>Company size</Label>
                  <Select
                    value={companySize}
                    onValueChange={(v) => v && setCompanySize(v as CompanySize | UnsetToken)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Not set">
                        {companySize === UNSET ? undefined : companySize}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={UNSET}>Not set</SelectItem>
                      {COMPANY_SIZES.map((s) => (
                        <SelectItem key={s} value={s}>
                          {COMPANY_SIZE_LABELS[s]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-2">
                  <Label>Revenue range</Label>
                  <Select
                    value={revenueRange}
                    onValueChange={(v) => v && setRevenueRange(v as RevenueRange | UnsetToken)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Not set">
                        {revenueRange === UNSET ? undefined : REVENUE_RANGES[revenueRange as RevenueRange]}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={UNSET}>Not set</SelectItem>
                      {REVENUE_KEYS.map((k) => (
                        <SelectItem key={k} value={k}>
                          {REVENUE_RANGES[k]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-2">
                  <Label>Push to Instantly</Label>
                  <Select
                    value={pushToInstantly}
                    onValueChange={(v) => v && setPushToInstantly(v as PushStatus | UnsetToken)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Not set">
                        {pushToInstantly === UNSET ? undefined : PUSH_STATUS_TONE[pushToInstantly as PushStatus].label}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={UNSET}>Not set</SelectItem>
                      {PUSH_KEYS.map((k) => (
                        <SelectItem key={k} value={k}>
                          {PUSH_STATUS_TONE[k].label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {channel === "cold_email" && lead && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="w-full"
                      onClick={() => setCampaignDialogOpen(true)}
                    >
                      Add to outreach campaign
                    </Button>
                  )}
                </div>
                <div className="grid gap-2">
                  <Label>Push to LinkedIn</Label>
                  <Select
                    value={pushToLinkedIn}
                    onValueChange={(v) => v && setPushToLinkedIn(v as PushStatus | UnsetToken)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Not set">
                        {pushToLinkedIn === UNSET ? undefined : PUSH_STATUS_TONE[pushToLinkedIn as PushStatus].label}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={UNSET}>Not set</SelectItem>
                      {PUSH_KEYS.map((k) => (
                        <SelectItem key={k} value={k}>
                          {PUSH_STATUS_TONE[k].label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </section>

            <Separator />

            <section className="space-y-3">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Qualification</p>
              <div className="grid gap-2">
                <Label>Stage</Label>
                <Select value={stage} onValueChange={(v) => v && setStage(v as PipelineStage)}>
                  <SelectTrigger>
                    <SelectValue>{selectTriggerLabelByKey(stage, PIPELINE_STAGES) ?? undefined}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {PIPELINE_STAGES.map((s) => (
                      <SelectItem key={s.key} value={s.key}>
                        {s.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-2">
                  <Label>Temperature</Label>
                  <Select value={temperature} onValueChange={(v) => v && setTemperature(v as LeadTemperature)}>
                    <SelectTrigger>
                      <SelectValue>{TEMPERATURE_TONE[temperature]?.label ?? undefined}</SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {(Object.keys(TEMPERATURE_TONE) as LeadTemperature[]).map((k) => (
                        <SelectItem key={k} value={k}>
                          {TEMPERATURE_TONE[k].label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-2">
                  <Label>Priority</Label>
                  <Select value={priority} onValueChange={(v) => v && setPriority(v as LeadPriority)}>
                    <SelectTrigger>
                      <SelectValue>{PRIORITY_TONE[priority]?.label ?? undefined}</SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {(Object.keys(PRIORITY_TONE) as LeadPriority[]).map((k) => (
                        <SelectItem key={k} value={k}>
                          {PRIORITY_TONE[k].label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-2">
                  <Label htmlFor="edit-ev">Est. value (USD)</Label>
                  <Input
                    id="edit-ev"
                    inputMode="decimal"
                    value={estimatedValue}
                    onChange={(e) => setEstimatedValue(e.target.value)}
                    placeholder="Optional"
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="edit-close">Expected close</Label>
                  <Input
                    id="edit-close"
                    type="date"
                    value={expectedClose}
                    onChange={(e) => setExpectedClose(e.target.value)}
                  />
                </div>
              </div>
              <div className="flex items-center justify-between gap-3 pt-1">
                <p className="text-xs font-medium text-muted-foreground">BANT scores</p>
                <div className="flex items-center gap-2">
                  <Switch checked={useBant} onCheckedChange={setUseBant} id="edit-bant-switch" size="sm" />
                  <Label htmlFor="edit-bant-switch" className="text-xs font-normal cursor-pointer">
                    Score this lead
                  </Label>
                </div>
              </div>
              {useBant && (
                <div className="grid grid-cols-2 gap-3">
                  {(
                    [
                      ["Budget", bantBudget, setBantBudget],
                      ["Authority", bantAuthority, setBantAuthority],
                      ["Need", bantNeed, setBantNeed],
                      ["Timeline", bantTimeline, setBantTimeline],
                    ] as const
                  ).map(([label, val, setVal]) => (
                    <div key={label} className="grid gap-2">
                      <Label>{label} (1–5)</Label>
                      <Select value={val} onValueChange={(v) => v && setVal(v)}>
                        <SelectTrigger>
                          <SelectValue>{val}</SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          {[1, 2, 3, 4, 5].map((n) => (
                            <SelectItem key={n} value={String(n)}>
                              {n}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <Separator />

            <section className="space-y-3">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Next steps</p>
              <div className="grid gap-2">
                <Label htmlFor="edit-next">Next action</Label>
                <Input
                  id="edit-next"
                  value={nextAction}
                  onChange={(e) => setNextAction(e.target.value)}
                  placeholder="e.g. Send proposal deck by Friday"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="edit-notes">Internal notes</Label>
                <Textarea
                  id="edit-notes"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={3}
                  className="resize-none"
                  placeholder="Team-only context…"
                />
              </div>
            </section>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={readOnly}>Save changes</Button>
          </DialogFooter>
        </form>
      </DialogContent>
      {lead && (
        <AddToCampaignDialog
          open={campaignDialogOpen}
          onOpenChange={setCampaignDialogOpen}
          leadIds={[lead.id]}
        />
      )}
    </Dialog>
  );
}
