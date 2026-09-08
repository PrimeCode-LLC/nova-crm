"use client";

import * as React from "react";
import { toast } from "sonner";
import type {
  Lead,
  LeadPriority,
  LeadTemperature,
  PipelineStage,
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
  CHANNELS_REQUIRING_OUTREACH_PROFILE,
  outreachProfileFieldLabel,
  TEMPERATURE_TONE,
  PRIORITY_TONE,
  PUSH_STATUS_TONE,
  INTAKE_KIND_META,
} from "@/lib/constants";
import { selectTriggerLabelByKey } from "@/lib/base-ui-select-label";
import { useChannelOptions } from "@/hooks/use-channel-options";
import { channelLabelFromValue } from "@/lib/channel-options";
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

export type LeadEditSection =
  | "all"
  | "labels"
  | "intake"
  | "research"
  | "personalization"
  | "qualification"
  | "routing"
  | "nextAction";

export function EditLeadDialog({
  open,
  onOpenChange,
  lead,
  onSave,
  section = "all",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  lead: Lead | null;
  onSave: (patch: Partial<Lead>) => void;
  section?: LeadEditSection;
}) {
  const channelOptions = useChannelOptions();
  const allChannelOptions = useChannelOptions({ includeDisabled: true });
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

  const [persTrigger, setPersTrigger] = React.useState("");
  const [persLikelyImpact, setPersLikelyImpact] = React.useState("");
  const [persRelevantService, setPersRelevantService] = React.useState("");
  const [persSuggestedAngle, setPersSuggestedAngle] = React.useState("");

  const [doNotContact, setDoNotContact] = React.useState(false);
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
  const [ownerId, setOwnerId] = React.useState<string | UnsetToken>(UNSET);
  const [scraperId, setScraperId] = React.useState<string | UnsetToken>(UNSET);
  const [labelIds, setLabelIds] = React.useState<string[]>([]);
  const { profiles, users, currentUserId, getOwnerDisplayName, canEditLead } = useWorkspace();

  const ownerPickerIds = React.useMemo(() => {
    const ids = new Set<string>();
    if (lead?.ownerId) ids.add(lead.ownerId);
    if (lead?.scraperId) ids.add(lead.scraperId);
    return [...ids];
  }, [lead]);

  const ownerOptions = React.useMemo(
    () => buildWorkspaceOwnerPickerOptions(users, currentUserId, getOwnerDisplayName, ownerPickerIds),
    [users, currentUserId, getOwnerDisplayName, ownerPickerIds],
  );

  const profileOptionsForChannel = React.useMemo(
    () => profiles.filter((p) => p.channel === channel && p.active !== false),
    [profiles, channel],
  );

  // Hydrate once per open session for this lead id.
  // Production Firestore can briefly clear `lead` mid-edit; tying hydrate to
  // `open ? lead?.id` re-ran (and `if (!lead) return null` unmounted) and wiped
  // unsaved research fields after a few ms. Keep a snapshot and skip re-hydrate.
  const hydratedLeadIdRef = React.useRef<string | null>(null);
  const leadSnapshotRef = React.useRef(lead);
  if (lead) leadSnapshotRef.current = lead;

  React.useEffect(() => {
    if (!open) {
      hydratedLeadIdRef.current = null;
      return;
    }
    const source = lead ?? leadSnapshotRef.current;
    if (!source?.id) return;
    if (hydratedLeadIdRef.current === source.id) return;
    hydratedLeadIdRef.current = source.id;

    setChannel(source.channel);
    setStage(source.stage);
    setTemperature(source.temperature);
    setPriority(source.priority);
    setNextAction(source.nextAction ?? "");
    setNotes(source.notes ?? "");
    setEstimatedValue(source.estimatedValue != null ? String(source.estimatedValue) : "");
    setExpectedClose(dateInputFromIso(source.expectedCloseDate));

    setTriggerEvent(source.triggerEvent ?? "");
    setBusinessFocus(source.businessFocus ?? "");
    setPainPoints(source.painPoints ?? "");
    setRecentNews(source.recentNews ?? "");
    setHiringSignals(source.hiringSignals ?? "");
    setPsLine(source.psLine ?? "");
    setToolsUsedStr(toolsUsedToString(source.toolsUsed));

    setPersTrigger(source.personalizationNote?.trigger ?? "");
    setPersLikelyImpact(source.personalizationNote?.likelyImpact ?? "");
    setPersRelevantService(source.personalizationNote?.relevantService ?? "");
    setPersSuggestedAngle(source.personalizationNote?.suggestedAngle ?? "");

    setDoNotContact(!!source.doNotContact);
    setPushToInstantly(source.pushToInstantly ?? UNSET);
    setPushToLinkedIn(source.pushToLinkedIn ?? UNSET);

    const b = source.bant;
    setUseBant(!!b);
    setBantBudget(String(b?.budget ?? 3));
    setBantAuthority(String(b?.authority ?? 3));
    setBantNeed(String(b?.need ?? 3));
    setBantTimeline(String(b?.timeline ?? 3));

    const ch = source.channel;
    if (CHANNELS_REQUIRING_OUTREACH_PROFILE.includes(ch)) {
      const opts = profiles.filter((p) => p.channel === ch && p.active !== false);
      const want = source.profileId?.trim() ?? "";
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

    setIntakeKind(source.intakeKind ?? "sales_lead");
    setOwnerId(source.ownerId?.trim() || UNSET);
    const existingScraper = source.scraperId?.trim();
    const me = currentUserId?.trim();
    setScraperId(existingScraper || (me ? me : UNSET));
    setLabelIds(source.labelIds ?? []);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per open session
  }, [open, lead?.id]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const source = lead ?? leadSnapshotRef.current;
    if (!source) return;
    const editsRouting = section === "all" || section === "routing";
    const editsQualification = section === "all" || section === "qualification";

    if (editsRouting && CHANNELS_REQUIRING_OUTREACH_PROFILE.includes(channel)) {
      const opts = profiles.filter((p) => p.channel === channel && p.active !== false);
      if (opts.length > 0 && !profileId.trim()) {
        toast.error(
          channel === "upwork" ? "Select an Upwork profile." : "Select a CV / apply profile.",
        );
        return;
      }
    }

    let estimatedValueNum: number | undefined;
    if (editsQualification) {
      const evRaw = estimatedValue.trim();
      if (evRaw) {
        const n = Number(evRaw.replace(/,/g, ""));
        if (!Number.isFinite(n) || n < 0) {
          toast.error("Estimated value must be a valid number.");
          return;
        }
        estimatedValueNum = n;
      }
    }

    let bant: BANT | undefined;
    if (editsQualification && useBant) {
      bant = {
        budget: clampBant(Number(bantBudget)),
        authority: clampBant(Number(bantAuthority)),
        need: clampBant(Number(bantNeed)),
        timeline: clampBant(Number(bantTimeline)),
      };
    }

    const patch: Partial<Lead> = {};

    if (section === "all" || section === "intake") {
      patch.intakeKind = intakeKind === "sales_lead" ? undefined : "prospect";
      patch.ownerId = ownerId === UNSET ? "" : ownerId;
      patch.scraperId = scraperId === UNSET ? undefined : scraperId;
    }

    if (section === "all" || section === "labels") {
      patch.labelIds = labelIds.length ? labelIds : undefined;
    }

    if (section === "all" || section === "research") {
      patch.triggerEvent = triggerEvent.trim() || undefined;
      patch.businessFocus = businessFocus.trim() || undefined;
      patch.painPoints = painPoints.trim() || undefined;
      patch.recentNews = recentNews.trim() || undefined;
      patch.hiringSignals = hiringSignals.trim() || undefined;
      patch.psLine = psLine.trim() || undefined;
      patch.toolsUsed = parseToolsUsed(toolsUsedStr);
    }

    if (section === "all" || section === "personalization") {
      const note = {
        trigger: persTrigger.trim(),
        likelyImpact: persLikelyImpact.trim(),
        relevantService: persRelevantService.trim(),
        suggestedAngle: persSuggestedAngle.trim(),
      };
      const hasAny = Object.values(note).some(Boolean);
      patch.personalizationNote = hasAny ? note : undefined;
    }

    if (editsRouting) {
      patch.channel = channel;
      patch.profileId = CHANNELS_REQUIRING_OUTREACH_PROFILE.includes(channel)
        ? profileId.trim() || undefined
        : undefined;
      patch.doNotContact = doNotContact;
      patch.pushToInstantly = pushToInstantly === UNSET ? undefined : pushToInstantly;
      patch.pushToLinkedIn = pushToLinkedIn === UNSET ? undefined : pushToLinkedIn;
    }

    if (editsQualification) {
      patch.stage = stage;
      patch.temperature = temperature;
      patch.priority = priority;
      patch.estimatedValue = estimatedValueNum;
      patch.expectedCloseDate = isoFromDateInput(expectedClose);
      patch.bant = bant;
    }

    if (section === "all" || section === "nextAction") {
      patch.nextAction = nextAction.trim() || undefined;
      patch.notes = notes.trim() || undefined;
    }

    onSave(patch);
    toast.success("Lead updated");
    onOpenChange(false);
  }

  const displayLead = lead ?? leadSnapshotRef.current;
  if (!displayLead) return null;
  const readOnly = !canEditLead(displayLead);
  const dialogTitle =
    section === "labels"
      ? "Edit labels"
      : section === "intake"
        ? "Edit intake & ownership"
        : section === "research"
          ? "Edit research & personalization"
          : section === "personalization"
            ? "Edit structured personalization"
            : section === "qualification"
              ? "Edit qualification"
              : section === "routing"
                ? "Edit campaign routing"
                : section === "nextAction"
                  ? "Edit next action"
                  : "Edit lead";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl" showCloseButton>
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>{dialogTitle}</DialogTitle>
            <DialogDescription>
            {readOnly ? "This lead was created from a prospect push. Only workspace admins can edit it." : null}
              Update {section === "all" ? "this lead" : "these fields"} for {displayLead.contactName}.
            </DialogDescription>
          </DialogHeader>          <div className="grid gap-4 py-2 max-h-[min(78vh,640px)] overflow-y-auto pr-1">
            {(section === "all" || section === "intake") && <section className="space-y-3">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                Intake & ownership
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
                  <Label>Owner</Label>
                  <Select
                    value={ownerId}
                    onValueChange={(v) => v && setOwnerId(v as string | UnsetToken)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Open queue">
                        {ownerId === UNSET
                          ? "Open queue (unassigned)"
                          : ownerOptions.find((o) => o.id === ownerId)?.label}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={UNSET}>Open queue (unassigned)</SelectItem>
                      {ownerOptions.map((o) => (
                        <SelectItem key={o.id} value={o.id}>
                          {o.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
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
                          : ownerOptions.find((o) => o.id === scraperId)?.label}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={UNSET}>Not set</SelectItem>
                      {ownerOptions.map((o) => (
                        <SelectItem key={o.id} value={o.id}>
                          {o.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </section>}

            {section === "all" && <Separator />}

            {(section === "all" || section === "labels") && <section className="space-y-3">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Labels</p>
              <EntityLabelPicker emphasizeAddAction labelIds={labelIds} onChange={setLabelIds} />
            </section>}

            {section === "all" && <Separator />}

            {(section === "all" || section === "research") && <section className="space-y-3">
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
            </section>}

            {section === "all" && <Separator />}

            {(section === "all" || section === "personalization") && <section className="space-y-3">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                Structured personalization
              </p>
              <div className="grid gap-2">
                <Label htmlFor="edit-pers-trigger">Trigger</Label>
                <Textarea
                  id="edit-pers-trigger"
                  value={persTrigger}
                  onChange={(e) => setPersTrigger(e.target.value)}
                  rows={2}
                  className="resize-none"
                  placeholder="What recently happened?"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="edit-pers-impact">Likely impact</Label>
                <Textarea
                  id="edit-pers-impact"
                  value={persLikelyImpact}
                  onChange={(e) => setPersLikelyImpact(e.target.value)}
                  rows={2}
                  className="resize-none"
                  placeholder="What need does this create?"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="edit-pers-service">Relevant service</Label>
                <Textarea
                  id="edit-pers-service"
                  value={persRelevantService}
                  onChange={(e) => setPersRelevantService(e.target.value)}
                  rows={2}
                  className="resize-none"
                  placeholder="Which capability addresses it?"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="edit-pers-angle">Suggested angle</Label>
                <Textarea
                  id="edit-pers-angle"
                  value={persSuggestedAngle}
                  onChange={(e) => setPersSuggestedAngle(e.target.value)}
                  rows={2}
                  className="resize-none"
                  placeholder="How should outreach lead?"
                />
              </div>
            </section>}

            {section === "all" && <Separator />}

            {(section === "all" || section === "routing") && <section className="space-y-3">
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
                    <SelectValue>
                      {channelLabelFromValue(channel, allChannelOptions) || channel}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {(channel && !channelOptions.some((c) => c.key === channel)
                      ? [
                          {
                            key: channel,
                            label: channelLabelFromValue(channel, allChannelOptions) || channel,
                          },
                          ...channelOptions,
                        ]
                      : channelOptions
                    ).map((c) => (
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
                  {channel === "cold_email" && displayLead && (
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
            </section>}

            {section === "all" && <Separator />}

            {(section === "all" || section === "qualification") && <section className="space-y-3">
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
            </section>}

            {section === "all" && <Separator />}

            {(section === "all" || section === "nextAction") && <section className="space-y-3">
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
            </section>}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={readOnly}>Save changes</Button>
          </DialogFooter>
        </form>
      </DialogContent>
      {displayLead && (
        <AddToCampaignDialog
          open={campaignDialogOpen}
          onOpenChange={setCampaignDialogOpen}
          leadIds={[displayLead.id]}
        />
      )}
    </Dialog>
  );
}
