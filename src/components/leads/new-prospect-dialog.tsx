"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type {
  Account,
  Contact,
  Lead,
  ChannelKey,
  CompanySize,
  RevenueRange,
  BusinessStatus,
  WebsiteStatus,
  OnlineActivityScore,
  EmailVerificationStatus,
  BestContactChannel,
  PipelineStage,
  LeadPriority,
  LeadTemperature,
} from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
  REVENUE_RANGES,
  COMPANY_SIZES,
  COMPANY_SIZE_LABELS,
  CHANNEL_LIST,
  PIPELINE_STAGES,
  PRIORITY_TONE,
  TEMPERATURE_TONE,
  CHANNELS_REQUIRING_OUTREACH_PROFILE,
  outreachProfileFieldLabel,
} from "@/lib/constants";
import { selectTriggerLabelByKey } from "@/lib/base-ui-select-label";
import { useWorkspace } from "@/components/providers/workspace-mode-provider";
import {
  buildWorkspaceOwnerPickerOptions,
  ownerPickerTriggerLabel,
} from "@/lib/owner-scope";
import { useAuth } from "@/components/providers/auth-provider";
import { useUserDoc } from "@/lib/hooks/use-user-doc";
import { getFirebaseDb } from "@/lib/firebase/client";
import { isFirebaseWebConfigured } from "@/lib/firebase/config";
import { persistLeadGraphClient } from "@/lib/firestore/persist-lead-graph-client";
import { persistLeadPatchClient } from "@/lib/firestore/persist-lead-patch-client";
import { COLLECTIONS } from "@/lib/firestore/collections";
import { doc, getDoc } from "firebase/firestore";
import { findContactByEmail } from "@/lib/crm-dedupe";
import { isAuthDisabled } from "@/lib/auth/flags";
import { useChannelAdminStore } from "@/stores/channel-admin-store";
import { buildChannelOptions } from "@/lib/channel-options";
import type { NewProspectPrefill } from "@/components/layout/quick-add-launcher";

const UNSET = "__unset__" as const;
const UNSET_SCRAPER = "__unset_scraper__" as const;

function newEntityId(prefix: string): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}`;
}

function newTimelineEventId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `te-${crypto.randomUUID()}`;
  }
  return `te-${Date.now()}`;
}

function isoFromDateInput(dateStr: string): string | undefined {
  if (!dateStr.trim()) return undefined;
  const d = new Date(`${dateStr}T12:00:00`);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

function parseTechStack(raw: string): string[] | undefined {
  const parts = raw
    .split(/[,;\n]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const uniq = [...new Set(parts)];
  return uniq.length ? uniq : undefined;
}

function techStackToString(tools?: string[]): string {
  return tools?.length ? tools.join(", ") : "";
}

function domainFromWebsiteOrEmail(website: string, email: string): string | undefined {
  const w = website.trim();
  if (w) {
    try {
      const u = new URL(w.includes("://") ? w : `https://${w}`);
      const host = u.hostname.replace(/^www\./i, "");
      if (host) return host;
    } catch {
      /* ignore */
    }
  }
  const e = email.trim().toLowerCase();
  if (e.includes("@")) {
    const d = e.split("@")[1]?.trim();
    if (d) return d;
  }
  return undefined;
}

const BUSINESS_STATUS_OPTS: { value: BusinessStatus; label: string }[] = [
  { value: "active", label: "Active" },
  { value: "new", label: "New" },
  { value: "dormant", label: "Dormant" },
];

const WEBSITE_STATUS_OPTS: { value: WebsiteStatus; label: string }[] = [
  { value: "live", label: "Live" },
  { value: "under_construction", label: "Under construction" },
  { value: "none", label: "No website" },
];

const ACTIVITY_OPTS: { value: OnlineActivityScore; label: string }[] = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
];

const EMAIL_VERIFY_OPTS: { value: EmailVerificationStatus; label: string }[] = [
  { value: "not_verified", label: "Not verified" },
  { value: "verified", label: "Verified" },
  { value: "bounced", label: "Bounced" },
  { value: "catch_all", label: "Catch-all" },
];

const BEST_CHANNEL_OPTS: { value: BestContactChannel; label: string }[] = [
  { value: "email", label: "Email" },
  { value: "phone", label: "Phone" },
  { value: "linkedin", label: "LinkedIn" },
  { value: "form", label: "Form" },
];

function emptyFormDefaults(uid: string | undefined) {
  return {
    ownerId: uid ?? "",
    scraperId: uid ?? "",
    channel: "cold_email" as ChannelKey,
    profileId: "",
    stage: "new" as PipelineStage,
    temperature: "cold" as LeadTemperature,
    priority: "medium" as LeadPriority,
    leadNotes: "",
    bizName: "",
    industry: "",
    bizDesc: "",
    city: "",
    state: "",
    country: "",
    yearFounded: "",
    bizStatus: UNSET as typeof UNSET | BusinessStatus,
    size: UNSET as typeof UNSET | CompanySize,
    rev: UNSET as typeof UNSET | RevenueRange,
    website: "",
    companyLinkedin: "",
    webStatus: UNSET as typeof UNSET | WebsiteStatus,
    techStackStr: "",
    activity: UNSET as typeof UNSET | OnlineActivityScore,
    lastSiteAt: "",
    lastSiteNote: "",
    careersUrl: "",
    firstName: "",
    lastName: "",
    title: "",
    email: "",
    personalEmail: "",
    emailVerify: UNSET as typeof UNSET | EmailVerificationStatus,
    phone: "",
    contactSource: "",
    bestChannel: UNSET as typeof UNSET | BestContactChannel,
    linkedin: "",
  };
}

export function NewProspectDialog({
  open,
  onOpenChange,
  initialPrefill,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialPrefill?: NewProspectPrefill;
}) {
  const router = useRouter();
  const {
    users,
    currentUserId,
    getOwnerDisplayName,
    profiles,
    contacts,
    addAccount,
    addContact,
    addLead,
    addTimelineEvent,
    isDemo,
  } = useWorkspace();
  const customChannels = useChannelAdminStore((s) => s.customChannels);
  const channelOptions = React.useMemo(() => buildChannelOptions(customChannels), [customChannels]);
  const { user: fbUser } = useAuth();
  const { data: liveUserDoc } = useUserDoc(
    isDemo || isAuthDisabled() || !fbUser ? undefined : fbUser.uid,
  );
  const [sessionOwnerId, setSessionOwnerId] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    void fetch("/api/auth/me", { credentials: "same-origin", cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) return;
        const data = (await res.json()) as { user?: { uid?: string } | null };
        const uid = data.user?.uid;
        if (!cancelled && uid) setSessionOwnerId(uid);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const effectiveUid = currentUserId || sessionOwnerId || undefined;

  const ownerLabelOverrides = React.useMemo(() => {
    const out: Record<string, string> = {};
    const uid = fbUser?.uid?.trim();
    if (!uid) return out;
    const fromDoc = liveUserDoc?.displayName?.trim();
    const fromAuth =
      typeof fbUser?.displayName === "string" && fbUser.displayName.trim().length > 0
        ? fbUser.displayName.trim()
        : "";
    const fromEmail =
      fbUser?.email && fbUser.email.includes("@")
        ? fbUser.email.split("@")[0]!.trim()
        : "";
    const name = fromDoc || fromAuth || fromEmail;
    if (name) out[uid] = name;
    return out;
  }, [fbUser?.uid, fbUser?.displayName, fbUser?.email, liveUserDoc?.displayName]);

  const F = emptyFormDefaults(effectiveUid);
  const [ownerId, setOwnerId] = React.useState(F.ownerId);
  const [scraperId, setScraperId] = React.useState(F.scraperId);
  const [channel, setChannel] = React.useState<ChannelKey>(
    initialPrefill?.channel ?? F.channel,
  );
  const [profileId, setProfileId] = React.useState(F.profileId);
  const [stage, setStage] = React.useState<PipelineStage>(F.stage);
  const [temperature, setTemperature] = React.useState<LeadTemperature>(F.temperature);
  const [priority, setPriority] = React.useState<LeadPriority>(F.priority);
  const [leadNotes, setLeadNotes] = React.useState(initialPrefill?.leadNotes ?? F.leadNotes);

  React.useEffect(() => {
    if (!open || !initialPrefill) return;
    if (initialPrefill.leadNotes !== undefined) setLeadNotes(initialPrefill.leadNotes);
    if (initialPrefill.channel !== undefined) setChannel(initialPrefill.channel);
  }, [open, initialPrefill]);

  const [bizName, setBizName] = React.useState(F.bizName);
  const [industry, setIndustry] = React.useState(F.industry);
  const [bizDesc, setBizDesc] = React.useState(F.bizDesc);
  const [city, setCity] = React.useState(F.city);
  const [state, setState] = React.useState(F.state);
  const [country, setCountry] = React.useState(F.country);
  const [yearFounded, setYearFounded] = React.useState(F.yearFounded);
  const [bizStatus, setBizStatus] = React.useState<typeof UNSET | BusinessStatus>(F.bizStatus);
  const [size, setSize] = React.useState<typeof UNSET | CompanySize>(F.size);
  const [rev, setRev] = React.useState<typeof UNSET | RevenueRange>(F.rev);
  const [website, setWebsite] = React.useState(F.website);
  const [companyLinkedin, setCompanyLinkedin] = React.useState(F.companyLinkedin);
  const [webStatus, setWebStatus] = React.useState<typeof UNSET | WebsiteStatus>(F.webStatus);
  const [techStackStr, setTechStackStr] = React.useState(F.techStackStr);
  const [activity, setActivity] = React.useState<typeof UNSET | OnlineActivityScore>(F.activity);
  const [lastSiteAt, setLastSiteAt] = React.useState(F.lastSiteAt);
  const [lastSiteNote, setLastSiteNote] = React.useState(F.lastSiteNote);
  const [careersUrl, setCareersUrl] = React.useState(F.careersUrl);

  const [firstName, setFirstName] = React.useState(F.firstName);
  const [lastName, setLastName] = React.useState(F.lastName);
  const [title, setTitle] = React.useState(F.title);
  const [email, setEmail] = React.useState(F.email);
  const [personalEmail, setPersonalEmail] = React.useState(F.personalEmail);
  const [emailVerify, setEmailVerify] = React.useState<typeof UNSET | EmailVerificationStatus>(F.emailVerify);
  const [phone, setPhone] = React.useState(F.phone);
  const [contactSource, setContactSource] = React.useState(F.contactSource);
  const [bestChannel, setBestChannel] = React.useState<typeof UNSET | BestContactChannel>(F.bestChannel);
  const [linkedin, setLinkedin] = React.useState(F.linkedin);

  const [submitting, setSubmitting] = React.useState(false);

  const ownerOptions = React.useMemo(() => {
    const ensure = [...new Set([effectiveUid, ownerId, scraperId].filter(Boolean) as string[])];
    return buildWorkspaceOwnerPickerOptions(
      users,
      currentUserId || sessionOwnerId || "",
      getOwnerDisplayName,
      ensure,
      ownerLabelOverrides,
    );
  }, [
    users,
    currentUserId,
    sessionOwnerId,
    getOwnerDisplayName,
    effectiveUid,
    ownerId,
    scraperId,
    ownerLabelOverrides,
  ]);

  React.useEffect(() => {
    if (!open) return;
    const d = emptyFormDefaults(effectiveUid);
    setOwnerId(d.ownerId);
    setScraperId(d.scraperId);
    setChannel(d.channel);
    setProfileId(d.profileId);
    setStage(d.stage);
    setTemperature(d.temperature);
    setPriority(d.priority);
    setLeadNotes(d.leadNotes);
    setBizName(d.bizName);
    setIndustry(d.industry);
    setBizDesc(d.bizDesc);
    setCity(d.city);
    setState(d.state);
    setCountry(d.country);
    setYearFounded(d.yearFounded);
    setBizStatus(d.bizStatus);
    setSize(d.size);
    setRev(d.rev);
    setWebsite(d.website);
    setCompanyLinkedin(d.companyLinkedin);
    setWebStatus(d.webStatus);
    setTechStackStr(d.techStackStr);
    setActivity(d.activity);
    setLastSiteAt(d.lastSiteAt);
    setLastSiteNote(d.lastSiteNote);
    setCareersUrl(d.careersUrl);
    setFirstName(d.firstName);
    setLastName(d.lastName);
    setTitle(d.title);
    setEmail(d.email);
    setPersonalEmail(d.personalEmail);
    setEmailVerify(d.emailVerify);
    setPhone(d.phone);
    setContactSource(d.contactSource);
    setBestChannel(d.bestChannel);
    setLinkedin(d.linkedin);
  }, [open, effectiveUid]);

  const channelNeedsProfile = CHANNELS_REQUIRING_OUTREACH_PROFILE.includes(channel);
  const profileOptionsForChannel = React.useMemo(
    () => profiles.filter((p) => p.channel === channel && p.active !== false),
    [profiles, channel],
  );

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const oid = effectiveUid?.trim() ?? "";
    if (!oid) {
      toast.error("Sign in to create a prospect.");
      return;
    }
    const bn = bizName.trim();
    if (!bn) {
      toast.error("Company is required.");
      return;
    }
    const fn = firstName.trim();
    const ln = lastName.trim();
    if (!fn || !ln) {
      toast.error("First and last name are required.");
      return;
    }
    const fullName = `${fn} ${ln}`.trim();

    const emailTrim = email.trim().toLowerCase();
    if (emailTrim) {
      const existing = findContactByEmail(contacts, emailTrim);
      if (existing) {
        toast.error("Contact already exists", {
          description: existing.fullName || `${existing.firstName} ${existing.lastName}`,
          action: {
            label: "View",
            onClick: () => {
              router.push(`/contacts/${existing.id}`);
              onOpenChange(false);
            },
          },
        });
        return;
      }
    }

    const yf = yearFounded.trim();
    let yearFoundedNum: number | undefined;
    if (yf) {
      const n = Number(yf);
      if (!Number.isFinite(n) || n < 1800 || n > new Date().getFullYear() + 1) {
        toast.error("Year founded should be a valid year.");
        return;
      }
      yearFoundedNum = Math.round(n);
    }

    const locParts = [city.trim(), state.trim(), country.trim()].filter(Boolean);
    const locationStr = locParts.length ? locParts.join(", ") : undefined;
    const domain = domainFromWebsiteOrEmail(website, email);

    const now = new Date().toISOString();
    const accountId = newEntityId("a");
    const contactId = newEntityId("ct");
    const leadId = newEntityId("l");

    const account: Account = {
      id: accountId,
      name: bn,
      domain,
      industry: industry.trim() || undefined,
      businessDescription: bizDesc.trim() || undefined,
      city: city.trim() || undefined,
      state: state.trim() || undefined,
      country: country.trim() || undefined,
      location: locationStr,
      yearFounded: yearFoundedNum,
      businessStatus: bizStatus === UNSET ? undefined : bizStatus,
      size: size === UNSET ? undefined : size,
      revenueRange: rev === UNSET ? undefined : rev,
      website: website.trim() || undefined,
      linkedin: companyLinkedin.trim() || undefined,
      websiteStatus: webStatus === UNSET ? undefined : webStatus,
      techStack: parseTechStack(techStackStr),
      onlineActivityScore: activity === UNSET ? undefined : activity,
      lastWebsiteActivityAt: isoFromDateInput(lastSiteAt),
      lastWebsiteActivityNote: lastSiteNote.trim() || undefined,
      careersPageUrl: careersUrl.trim() || undefined,
      contactCount: 0,
      leadCount: 1,
      openDealValue: 0,
      ownerId: oid,
      createdAt: now,
      updatedAt: now,
    };

    const contact: Contact = {
      id: contactId,
      accountId,
      firstName: fn,
      lastName: ln,
      fullName,
      email: emailTrim || undefined,
      personalEmail: personalEmail.trim() || undefined,
      emailVerificationStatus: emailVerify === UNSET ? undefined : emailVerify,
      phone: phone.trim() || undefined,
      title: title.trim() || undefined,
      linkedin: linkedin.trim() || undefined,
      contactSource: contactSource.trim() || undefined,
      bestContactChannel: bestChannel === UNSET ? undefined : bestChannel,
      ownerId: oid,
      createdAt: now,
      updatedAt: now,
    };

    const createdById = oid;
    const placeholderChannel: ChannelKey = "website_form";
    const lead: Lead = {
      id: leadId,
      accountId,
      contactId,
      channel: placeholderChannel,
      stage,
      temperature,
      priority,
      ownerId: oid,
      createdById,
      scraperId: oid,
      intakeKind: "prospect",
      prospectOwnerId: oid,
      prospectVisibility: "open",
      contactName: fullName,
      contactTitle: title.trim() || undefined,
      contactEmail: emailTrim || undefined,
      contactLinkedIn: linkedin.trim() || undefined,
      companyName: bn,
      companyDomain: domain,
      companyIndustry: industry.trim() || undefined,
      companySize: size === UNSET ? undefined : size,
      revenueRange: rev === UNSET ? undefined : rev,
      touches: 0,
      isIdle: false,
      notes: leadNotes.trim() || undefined,
      createdAt: now,
      updatedAt: now,
    };

    const creatorLabel =
      getOwnerDisplayName(oid)?.trim() ||
      liveUserDoc?.displayName?.trim() ||
      (fbUser?.email?.includes("@") ? fbUser.email.split("@")[0]!.trim() : "") ||
      "Teammate";

    setSubmitting(true);
    try {
      if (!isDemo && liveUserDoc?.organizationId && isFirebaseWebConfigured()) {
        const db = getFirebaseDb();
        await persistLeadGraphClient(db, liveUserDoc.organizationId, account, contact, lead);
        const saved = await getDoc(doc(db, COLLECTIONS.leads, leadId));
        if (saved.exists()) {
          const data = saved.data();
          const needsRepair =
            data.intakeKind !== "prospect" || data.prospectVisibility !== "open";
          if (needsRepair) {
            await persistLeadPatchClient(db, leadId, {
              intakeKind: "prospect",
              prospectVisibility: "open",
              prospectOwnerId: oid,
            });
          }
        }
      } else {
        await addAccount(account);
        await addContact(contact);
        await addLead(lead);
      }
      addTimelineEvent({
        id: newTimelineEventId(),
        leadId,
        type: "lead_created",
        actorId: createdById,
        summary: `Prospect created by ${creatorLabel}. Add channels when ready.`,
        createdAt: now,
      });
      toast.success("Prospect created — add channels when ready.");
      onOpenChange(false);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error("Could not save prospect", { description: msg });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex flex-col min-h-0 sm:max-w-3xl w-[calc(100vw-1.5rem)] max-h-[min(92vh,880px)] overflow-hidden gap-0 p-0"
        showCloseButton
      >
        <form
          onSubmit={(e) => void handleSubmit(e)}
          className="flex min-h-0 flex-1 flex-col"
        >
          <DialogHeader className="px-6 pt-6 pb-3 shrink-0 border-b">
            <DialogTitle>New prospect</DialogTitle>
            <DialogDescription>
              Create an intake record for research. You become the Prospect owner. Add channels and assign teammates
              from the prospect detail page, then assignees push their channel into a shared sales lead.
            </DialogDescription>
          </DialogHeader>

          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4 space-y-6">
            <section className="space-y-3">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                Intake defaults
              </p>
              <div className="grid sm:grid-cols-2 gap-3">
                <div className="grid gap-1.5">
                  <Label>Pipeline stage</Label>
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
                <div className="grid gap-1.5">
                  <Label>Temperature</Label>
                  <Select
                    value={temperature}
                    onValueChange={(v) => v && setTemperature(v as LeadTemperature)}
                  >
                    <SelectTrigger>
                      <SelectValue>{TEMPERATURE_TONE[temperature]?.label}</SelectValue>
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
                <div className="grid gap-1.5">
                  <Label>Priority</Label>
                  <Select value={priority} onValueChange={(v) => v && setPriority(v as LeadPriority)}>
                    <SelectTrigger>
                      <SelectValue>{PRIORITY_TONE[priority]?.label}</SelectValue>
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
                <div className="grid gap-1.5 sm:col-span-2">
                  <Label>Internal notes (lead)</Label>
                  <Textarea
                    value={leadNotes}
                    onChange={(e) => setLeadNotes(e.target.value)}
                    rows={2}
                    className="resize-none"
                    placeholder="Team-only context…"
                  />
                </div>
              </div>
            </section>

            <Separator />

            <section className="space-y-3">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Company</p>
              <div className="grid sm:grid-cols-2 gap-3">
                <div className="grid gap-1.5 sm:col-span-2">
                  <Label>Company</Label>
                  <Input
                    value={bizName}
                    onChange={(e) => setBizName(e.target.value)}
                    required
                    placeholder="Stellixsoft, Acme Inc."
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label>Industry</Label>
                  <Input
                    value={industry}
                    onChange={(e) => setIndustry(e.target.value)}
                    placeholder="Real estate, Software house…"
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label>Year founded</Label>
                  <Input value={yearFounded} onChange={(e) => setYearFounded(e.target.value)} placeholder="2018" />
                </div>
                <div className="grid gap-1.5 sm:col-span-2">
                  <Label>Business description (short one-liner)</Label>
                  <Input
                    value={bizDesc}
                    onChange={(e) => setBizDesc(e.target.value)}
                    placeholder="What they do in one sentence"
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label>City</Label>
                  <Input value={city} onChange={(e) => setCity(e.target.value)} />
                </div>
                <div className="grid gap-1.5">
                  <Label>State / region</Label>
                  <Input value={state} onChange={(e) => setState(e.target.value)} />
                </div>
                <div className="grid gap-1.5">
                  <Label>Country</Label>
                  <Input value={country} onChange={(e) => setCountry(e.target.value)} />
                </div>
                <div className="grid gap-1.5">
                  <Label>Business status</Label>
                  <Select value={bizStatus} onValueChange={(v) => v && setBizStatus(v as BusinessStatus | typeof UNSET)}>
                    <SelectTrigger>
                      <SelectValue placeholder="Not set" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={UNSET}>Not set</SelectItem>
                      {BUSINESS_STATUS_OPTS.map((o) => (
                        <SelectItem key={o.value} value={o.value}>
                          {o.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-1.5">
                  <Label>Company size</Label>
                  <Select value={size} onValueChange={(v) => v && setSize(v as CompanySize | typeof UNSET)}>
                    <SelectTrigger>
                      <SelectValue placeholder="Not set" />
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
                <div className="grid gap-1.5">
                  <Label>Revenue range (est.)</Label>
                  <Select value={rev} onValueChange={(v) => v && setRev(v as RevenueRange | typeof UNSET)}>
                    <SelectTrigger>
                      <SelectValue placeholder="Not set" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={UNSET}>Not set</SelectItem>
                      {(Object.keys(REVENUE_RANGES) as RevenueRange[]).map((k) => (
                        <SelectItem key={k} value={k}>
                          {REVENUE_RANGES[k]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-1.5 sm:col-span-2">
                  <Label>Website URL</Label>
                  <Input value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="https://…" />
                </div>
                <div className="grid gap-1.5 sm:col-span-2">
                  <Label>Company LinkedIn URL</Label>
                  <Input
                    value={companyLinkedin}
                    onChange={(e) => setCompanyLinkedin(e.target.value)}
                    placeholder="https://linkedin.com/company/…"
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label>Website status</Label>
                  <Select
                    value={webStatus}
                    onValueChange={(v) => v && setWebStatus(v as WebsiteStatus | typeof UNSET)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Not set" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={UNSET}>Not set</SelectItem>
                      {WEBSITE_STATUS_OPTS.map((o) => (
                        <SelectItem key={o.value} value={o.value}>
                          {o.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-1.5">
                  <Label>Online activity score</Label>
                  <Select
                    value={activity}
                    onValueChange={(v) => v && setActivity(v as OnlineActivityScore | typeof UNSET)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Not set" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={UNSET}>Not set</SelectItem>
                      {ACTIVITY_OPTS.map((o) => (
                        <SelectItem key={o.value} value={o.value}>
                          {o.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-1.5">
                  <Label>Last website update / activity (date)</Label>
                  <Input type="date" value={lastSiteAt} onChange={(e) => setLastSiteAt(e.target.value)} />
                </div>
                <div className="grid gap-1.5 sm:col-span-2">
                  <Label>Last website activity (observation)</Label>
                  <Textarea
                    value={lastSiteNote}
                    onChange={(e) => setLastSiteNote(e.target.value)}
                    rows={2}
                    className="resize-none"
                    placeholder="Notes if no exact date"
                  />
                </div>
                <div className="grid gap-1.5 sm:col-span-2">
                  <Label>Tech stack / platform</Label>
                  <Input
                    value={techStackStr}
                    onChange={(e) => setTechStackStr(e.target.value)}
                    placeholder="WordPress, Shopify, Webflow, comma-separated"
                  />
                </div>
                <div className="grid gap-1.5 sm:col-span-2">
                  <Label>Careers page URL</Label>
                  <Input value={careersUrl} onChange={(e) => setCareersUrl(e.target.value)} placeholder="https://…" />
                </div>
              </div>
            </section>

            <Separator />

            <section className="space-y-3">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Contact</p>
              <div className="grid sm:grid-cols-2 gap-3">
                <div className="grid gap-1.5">
                  <Label>First name</Label>
                  <Input value={firstName} onChange={(e) => setFirstName(e.target.value)} required />
                </div>
                <div className="grid gap-1.5">
                  <Label>Last name</Label>
                  <Input value={lastName} onChange={(e) => setLastName(e.target.value)} required />
                </div>
                <div className="grid gap-1.5 sm:col-span-2">
                  <Label>Role / title</Label>
                  <Input value={title} onChange={(e) => setTitle(e.target.value)} />
                </div>
                <div className="grid gap-1.5">
                  <Label>Primary email (company)</Label>
                  <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
                </div>
                <div className="grid gap-1.5">
                  <Label>Personal email (optional)</Label>
                  <Input type="email" value={personalEmail} onChange={(e) => setPersonalEmail(e.target.value)} />
                </div>
                <div className="grid gap-1.5">
                  <Label>Email verified</Label>
                  <Select
                    value={emailVerify}
                    onValueChange={(v) => v && setEmailVerify(v as EmailVerificationStatus | typeof UNSET)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Not set" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={UNSET}>Not set</SelectItem>
                      {EMAIL_VERIFY_OPTS.map((o) => (
                        <SelectItem key={o.value} value={o.value}>
                          {o.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-1.5">
                  <Label>Phone number</Label>
                  <Input value={phone} onChange={(e) => setPhone(e.target.value)} />
                </div>
                <div className="grid gap-1.5">
                  <Label>Contact source</Label>
                  <Input
                    value={contactSource}
                    onChange={(e) => setContactSource(e.target.value)}
                    placeholder="Website, LinkedIn, Google Maps…"
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label>Best contact channel</Label>
                  <Select
                    value={bestChannel}
                    onValueChange={(v) => v && setBestChannel(v as BestContactChannel | typeof UNSET)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Not set" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={UNSET}>Not set</SelectItem>
                      {BEST_CHANNEL_OPTS.map((o) => (
                        <SelectItem key={o.value} value={o.value}>
                          {o.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-1.5 sm:col-span-2">
                  <Label>LinkedIn profile URL</Label>
                  <Input value={linkedin} onChange={(e) => setLinkedin(e.target.value)} placeholder="https://…" />
                </div>
              </div>
            </section>
          </div>

          <DialogFooter className="px-6 py-4 border-t shrink-0 bg-muted/20">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
              Cancel
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? "Saving…" : "Create prospect"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
