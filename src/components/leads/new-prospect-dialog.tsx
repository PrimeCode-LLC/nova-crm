"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, ChevronDown } from "lucide-react";
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
import { Checkbox } from "@/components/ui/checkbox";
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
  PIPELINE_STAGES,
  PRIORITY_TONE,
  TEMPERATURE_TONE,
  CHANNELS_REQUIRING_OUTREACH_PROFILE,
  outreachProfileFieldLabel,
} from "@/lib/constants";
import { selectTriggerLabelByKey } from "@/lib/base-ui-select-label";
import { useWorkspace } from "@/components/providers/workspace-mode-provider";
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
import { channelLabelFromValue } from "@/lib/channel-options";
import { useChannelOptions } from "@/hooks/use-channel-options";
import type { NewProspectPrefill } from "@/components/layout/quick-add-launcher";
import { cn } from "@/lib/utils";
import {
  useProspectingStrategyData,
} from "@/lib/hooks/use-prospecting-strategy-data";
import { activeAssignmentsForUser } from "@/lib/prospecting-strategy/allocation";
import { countCompanyContactsForUser } from "@/lib/prospecting-strategy/progress";
import { evaluateQualifyGate, formatPersonalizationNote } from "@/lib/prospecting-strategy/qualify";
import { resolveDailyTargets } from "@/lib/prospecting-strategy/types";
import {
  emptyQualifyFormState,
  ProspectQualifyPanel,
  type ProspectQualifyFormState,
} from "@/components/prospecting/prospect-qualify-panel";

const UNSET = "__unset__" as const;

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

function isValidOptionalUrl(raw: string): boolean {
  if (!raw.trim()) return true;
  try {
    const value = new URL(raw.trim());
    return value.protocol === "http:" || value.protocol === "https:";
  } catch {
    return false;
  }
}

function normalizedEmail(raw: string): string {
  return raw.trim().toLowerCase();
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

function emptyFormDefaults() {
  return {
    channel: "cold_email" as ChannelKey,
    profileId: "",
    stage: "new" as PipelineStage,
    temperature: "cold" as LeadTemperature,
    priority: "medium" as LeadPriority,
    leadNotes: "",
    triggerEvent: "",
    painPoints: "",
    doNotContact: false,
    nextAction: "",
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
    seniority: "",
    contactLocation: "",
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
    currentUserId,
    getOwnerDisplayName,
    profiles,
    contacts,
    leads,
    addAccount,
    addContact,
    addLead,
    addTimelineEvent,
    isDemo,
    intentPlaybook,
  } = useWorkspace();
  const channelOptions = useChannelOptions();
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

  const F = emptyFormDefaults();
  const [channel, setChannel] = React.useState<ChannelKey>(
    initialPrefill?.channel ?? F.channel,
  );
  const [profileId, setProfileId] = React.useState(F.profileId);
  const [stage, setStage] = React.useState<PipelineStage>(F.stage);
  const [temperature, setTemperature] = React.useState<LeadTemperature>(F.temperature);
  const [priority, setPriority] = React.useState<LeadPriority>(F.priority);
  const [leadNotes, setLeadNotes] = React.useState(initialPrefill?.leadNotes ?? F.leadNotes);
  const [triggerEvent, setTriggerEvent] = React.useState(F.triggerEvent);
  const [painPoints, setPainPoints] = React.useState(initialPrefill?.painPoints ?? F.painPoints);
  const [doNotContact, setDoNotContact] = React.useState(F.doNotContact);
  const [nextAction, setNextAction] = React.useState(F.nextAction);
  const [showAdvancedCompany, setShowAdvancedCompany] = React.useState(false);
  const [strategyId, setStrategyId] = React.useState(initialPrefill?.strategyId ?? "");
  const [personaId, setPersonaId] = React.useState(initialPrefill?.personaId ?? "");
  const [strategyAssignmentIdPrefill] = React.useState(
    initialPrefill?.strategyAssignmentId ?? "",
  );
  const [strategyVersionPrefill] = React.useState(initialPrefill?.strategyVersion);

  const prospecting = useProspectingStrategyData();
  const myActiveAssignments = React.useMemo(
    () => activeAssignmentsForUser(prospecting.assignments, currentUserId),
    [prospecting.assignments, currentUserId],
  );
  const selectableStrategies = React.useMemo(() => {
    const ids = new Set(myActiveAssignments.map((a) => a.strategyId));
    const fromAssign = prospecting.strategies.filter(
      (s) => ids.has(s.id) && s.status === "published",
    );
    if (fromAssign.length) return fromAssign;
    return prospecting.strategies.filter((s) => s.status === "published" || s.status === "draft");
  }, [myActiveAssignments, prospecting.strategies]);
  const selectedStrategy = selectableStrategies.find((s) => s.id === strategyId);
  const strategyPersonas = React.useMemo(() => {
    if (!selectedStrategy) return [];
    const assignment = myActiveAssignments.find((a) => a.strategyId === selectedStrategy.id);
    const pids = assignment?.personaIdsOverride?.length
      ? assignment.personaIdsOverride
      : selectedStrategy.personaIds;
    return prospecting.personas.filter((p) => pids.includes(p.id) && p.active);
  }, [selectedStrategy, myActiveAssignments, prospecting.personas]);

  React.useEffect(() => {
    if (!open) return;
    if (initialPrefill?.strategyId) setStrategyId(initialPrefill.strategyId);
    if (initialPrefill?.personaId) setPersonaId(initialPrefill.personaId);
  }, [open, initialPrefill?.strategyId, initialPrefill?.personaId]);

  const [qualifyForm, setQualifyForm] = React.useState<ProspectQualifyFormState>(emptyQualifyFormState);

  React.useEffect(() => {
    if (open) setQualifyForm(emptyQualifyFormState());
  }, [open]);

  const maxContacts =
    resolveDailyTargets(selectedStrategy).maxContactsPerCompany ?? 2;

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
  const [seniority, setSeniority] = React.useState(F.seniority);
  const [contactLocation, setContactLocation] = React.useState(F.contactLocation);
  const [email, setEmail] = React.useState(F.email);
  const [personalEmail, setPersonalEmail] = React.useState(F.personalEmail);
  const [emailVerify, setEmailVerify] = React.useState<typeof UNSET | EmailVerificationStatus>(F.emailVerify);
  const [phone, setPhone] = React.useState(F.phone);
  const [contactSource, setContactSource] = React.useState(F.contactSource);
  const [bestChannel, setBestChannel] = React.useState<typeof UNSET | BestContactChannel>(F.bestChannel);
  const [linkedin, setLinkedin] = React.useState(F.linkedin);

  const [submitting, setSubmitting] = React.useState(false);

  const channelNeedsProfile = CHANNELS_REQUIRING_OUTREACH_PROFILE.includes(channel);
  const profileOptionsForChannel = React.useMemo(
    () => profiles.filter((p) => p.channel === channel && p.active !== false),
    [profiles, channel],
  );
  const readinessIssues = React.useMemo(() => {
    const issues: string[] = [];
    if (doNotContact) return ["Outreach is blocked by do-not-contact"];
    if (!triggerEvent.trim()) issues.push("Add a trigger event");
    if ((channel === "cold_email" || channel === "personalized_email") && !email.trim()) {
      issues.push("Add a company email");
    }
    if ((channel === "linkedin_outbound" || channel === "linkedin_1to1") && !linkedin.trim()) {
      issues.push("Add a LinkedIn profile");
    }
    if (channelNeedsProfile && !profileId) issues.push(`Select ${outreachProfileFieldLabel(channel).toLowerCase()}`);
    if (emailVerify === "bounced") issues.push("Replace the bounced email");
    return issues;
  }, [
    channel,
    channelNeedsProfile,
    doNotContact,
    email,
    emailVerify,
    linkedin,
    profileId,
    triggerEvent,
  ]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const oid = effectiveUid?.trim() ?? "";
    if (!oid) {
      toast.error("Sign in to create a prospect.");
      return;
    }
    const bn = bizName.trim();
    if (!bn) {
      toast.error("Business name is required.");
      return;
    }
    const fn = firstName.trim();
    const ln = lastName.trim();
    if (!fn || !ln) {
      toast.error("First and last name are required.");
      return;
    }
    const fullName = `${fn} ${ln}`.trim();

    const emailTrim = normalizedEmail(email);
    const personalEmailTrim = normalizedEmail(personalEmail);
    if (emailTrim && personalEmailTrim && emailTrim === personalEmailTrim) {
      toast.error("Company and personal email must be different.");
      return;
    }
    if (emailTrim) {
      const existing =
        findContactByEmail(contacts, emailTrim) ||
        contacts.find((c) => normalizedEmail(c.personalEmail ?? "") === emailTrim);
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
    if (personalEmailTrim) {
      const existing = contacts.find((c) =>
        [c.email, c.personalEmail].some((value) => normalizedEmail(value ?? "") === personalEmailTrim),
      );
      if (existing) {
        toast.error("Personal email already belongs to a contact", {
          description: existing.fullName,
        });
        return;
      }
    }

    const urls: [string, string][] = [
      ["Website", website],
      ["Company LinkedIn", companyLinkedin],
      ["Careers page", careersUrl],
      ["Contact LinkedIn", linkedin],
    ];
    const invalidUrl = urls.find(([, value]) => !isValidOptionalUrl(value));
    if (invalidUrl) {
      toast.error(`${invalidUrl[0]} must be a complete http(s) URL.`);
      return;
    }

    const domain = domainFromWebsiteOrEmail(website, email);
    const existingCompanyContacts = countCompanyContactsForUser(
      leads,
      oid,
      domain,
      bn,
    );
    const emailIsVerified = emailVerify === "verified";

    if (qualifyForm.qualifyStatus === "completed") {
      const gate = evaluateQualifyGate({
        companyName: bn,
        companyWebsite: website.trim(),
        contactName: fullName,
        contactTitle: title.trim(),
        contactLinkedIn: linkedin.trim(),
        emailVerified: emailIsVerified,
        intentEvidence: qualifyForm.evidence,
        personalizationNote: qualifyForm.personalization,
        primaryOpportunityLabel: qualifyForm.primaryOpportunityLabel,
        outreachThreshold: intentPlaybook.outreachThreshold,
        existingContactsForCompany: existingCompanyContacts,
        maxContactsPerCompany: maxContacts,
      });
      if (!gate.ok) {
        toast.error("Cannot mark as completed", {
          description: gate.issues
            .filter((i) => i.blocking)
            .map((i) => i.message)
            .slice(0, 3)
            .join(" · "),
        });
        return;
      }
    }
    if (qualifyForm.qualifyStatus === "rejected" && !qualifyForm.rejectionReason) {
      toast.error("Select a rejection reason.");
      return;
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
    if (lastSiteAt && new Date(`${lastSiteAt}T12:00:00`).getTime() > Date.now()) {
      toast.error("Last website activity cannot be in the future.");
      return;
    }

    const locParts = [city.trim(), state.trim(), country.trim()].filter(Boolean);
    const locationStr = locParts.length ? locParts.join(", ") : undefined;

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
      personalEmail: personalEmailTrim || undefined,
      emailVerificationStatus: emailVerify === UNSET ? undefined : emailVerify,
      phone: phone.trim() || undefined,
      title: title.trim() || undefined,
      seniority: seniority.trim() || undefined,
      location: contactLocation.trim() || undefined,
      linkedin: linkedin.trim() || undefined,
      contactSource: contactSource.trim() || undefined,
      bestContactChannel: bestChannel === UNSET ? undefined : bestChannel,
      ownerId: oid,
      createdAt: now,
      updatedAt: now,
    };

    const createdById = oid;
    const lead: Lead = {
      id: leadId,
      accountId,
      contactId,
      channel,
      profileId: profileId || undefined,
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
      painPoints: painPoints.trim() || undefined,
      doNotContact,
      touches: 0,
      isIdle: false,
      notes: leadNotes.trim() || undefined,
      nextAction: nextAction.trim() || undefined,
      strategyId: strategyId || undefined,
      personaId: personaId || undefined,
      strategyVersion: strategyId
        ? strategyVersionPrefill ?? selectedStrategy?.version
        : undefined,
      strategyAssignmentId: strategyId
        ? strategyAssignmentIdPrefill ||
          myActiveAssignments.find((a) => a.strategyId === strategyId)?.id
        : undefined,
      intentEvidence:
        qualifyForm.evidence.filter((e) => e.label.trim() || e.sourceUrl.trim()).length > 0
          ? qualifyForm.evidence
          : undefined,
      personalizationNote: qualifyForm.personalization,
      prospectQualifyStatus: qualifyForm.qualifyStatus,
      rejectionReason:
        qualifyForm.qualifyStatus === "rejected" && qualifyForm.rejectionReason
          ? qualifyForm.rejectionReason
          : undefined,
      rejectionNote:
        qualifyForm.qualifyStatus === "rejected"
          ? qualifyForm.rejectionNote.trim() || undefined
          : undefined,
      deeplyPersonalized: qualifyForm.deeplyPersonalized || undefined,
      emailVerified: emailIsVerified || undefined,
      primaryOpportunityLabel: qualifyForm.primaryOpportunityLabel.trim() || undefined,
      psLine: formatPersonalizationNote(qualifyForm.personalization).trim() || undefined,
      triggerEvent:
        triggerEvent.trim() ||
        qualifyForm.evidence.find((e) => e.label.trim())?.label ||
        undefined,
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
        summary: `Prospect created by ${creatorLabel} for ${channelLabelFromValue(channel, channelOptions) || channel}. Add channel assignments when ready.`,
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
              Add the essentials now. Company research can be completed later from the prospect record.
            </DialogDescription>
          </DialogHeader>

          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4 space-y-6">
            {selectableStrategies.length > 0 ? (
              <section className="space-y-3">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  Strategy attribution
                </p>
                <div className="grid sm:grid-cols-2 gap-3">
                  <div className="grid gap-1.5">
                    <Label>Prospecting strategy</Label>
                    <Select
                      value={strategyId || "__none__"}
                      onValueChange={(v) => {
                        const next = v === "__none__" ? "" : v ?? "";
                        setStrategyId(next);
                        setPersonaId("");
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue>
                          {selectedStrategy?.name ?? "None"}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">None</SelectItem>
                        {selectableStrategies.map((s) => (
                          <SelectItem key={s.id} value={s.id}>
                            {s.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid gap-1.5">
                    <Label>Buyer persona</Label>
                    <Select
                      value={personaId || "__none__"}
                      onValueChange={(v) => setPersonaId(v === "__none__" ? "" : v ?? "")}
                      disabled={!strategyId}
                    >
                      <SelectTrigger>
                        <SelectValue>
                          {strategyPersonas.find((p) => p.id === personaId)?.name ?? "None"}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">None</SelectItem>
                        {strategyPersonas.map((p) => (
                          <SelectItem key={p.id} value={p.id}>
                            {p.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                {selectedStrategy ? (
                  <div className="rounded-md border bg-muted/30 px-3 py-2 space-y-1.5">
                    <p className="text-xs font-medium">Quality checklist</p>
                    {selectedStrategy.qualityChecklist
                      .filter((c) => c.requirement !== "not_needed")
                      .slice(0, 8)
                      .map((c) => (
                        <div key={c.id} className="flex items-start gap-2 text-xs text-muted-foreground">
                          <CheckCircle2 className="size-3.5 mt-0.5 shrink-0" />
                          <span>
                            <span className="text-foreground">{c.label}</span>
                            {c.requirement === "required" ? " · required" : " · optional"}
                          </span>
                        </div>
                      ))}
                  </div>
                ) : null}
              </section>
            ) : null}

            <section className="space-y-3">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                Intake defaults
              </p>
              <div className="grid sm:grid-cols-2 gap-3">
                <div className="grid gap-1.5">
                  <Label>Intended channel</Label>
                  <Select
                    value={channel}
                    onValueChange={(v) => {
                      if (!v) return;
                      setChannel(v as ChannelKey);
                      setProfileId("");
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue>
                        {selectTriggerLabelByKey(channel, channelOptions) ?? undefined}
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
                </div>
                {channelNeedsProfile ? (
                  <div className="grid gap-1.5">
                    <Label>{outreachProfileFieldLabel(channel)}</Label>
                    <Select value={profileId || undefined} onValueChange={(v) => v && setProfileId(v)}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select profile">
                          {profiles.find((profile) => profile.id === profileId)?.name}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        {profileOptionsForChannel.map((profile) => (
                          <SelectItem key={profile.id} value={profile.id}>
                            {profile.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ) : null}
                <div className="grid gap-1.5">
                  <Label>Pipeline stage</Label>
                  <Select value={stage} onValueChange={(v) => v && setStage(v as PipelineStage)}>
                    <SelectTrigger>
                      <SelectValue>{selectTriggerLabelByKey(stage, PIPELINE_STAGES) ?? undefined}</SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {PIPELINE_STAGES.filter((s) => !s.isTerminal).map((s) => (
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
                  <Label>Next action</Label>
                  <Input
                    value={nextAction}
                    onChange={(e) => setNextAction(e.target.value)}
                    placeholder="Research decision-maker, verify email, draft opener…"
                  />
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
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Outreach readiness
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Capture why this prospect matters before assigning outreach.
                </p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="grid gap-1.5 sm:col-span-2">
                  <Label>Trigger event</Label>
                  <Input
                    value={triggerEvent}
                    onChange={(e) => setTriggerEvent(e.target.value)}
                    placeholder="Hiring, funding, expansion, outdated website…"
                  />
                </div>
                <div className="grid gap-1.5 sm:col-span-2">
                  <Label>Pain points</Label>
                  <Textarea
                    value={painPoints}
                    onChange={(e) => setPainPoints(e.target.value)}
                    rows={2}
                    className="resize-none"
                    placeholder="Likely problems your outreach should address"
                  />
                </div>
                <label className="flex items-start gap-3 rounded-md border p-3 sm:col-span-2">
                  <Checkbox
                    checked={doNotContact}
                    onCheckedChange={(checked) => setDoNotContact(checked === true)}
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
                  {readinessIssues.length ? <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> : null}
                  <span>
                    {readinessIssues.length
                      ? `Not ready for ${channelLabelFromValue(channel, channelOptions) || channel}: ${readinessIssues.join(
                          " · ",
                        )}`
                      : `Ready for ${channelLabelFromValue(channel, channelOptions) || channel}`}
                  </span>
                </div>
              </div>
            </section>

            <Separator />

            <section className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Business</p>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => setShowAdvancedCompany((value) => !value)}
                >
                  {showAdvancedCompany ? "Hide" : "Show"} advanced research
                  <ChevronDown
                    className={cn("h-3.5 w-3.5 transition-transform", showAdvancedCompany && "rotate-180")}
                  />
                </Button>
              </div>
              <div className="grid sm:grid-cols-2 gap-3">
                <div className="grid gap-1.5 sm:col-span-2">
                  <Label>Business Name</Label>
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
                <div className={cn("grid gap-1.5", !showAdvancedCompany && "hidden")}>
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
                <div className={cn("grid gap-1.5", !showAdvancedCompany && "hidden")}>
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
                <div className={cn("grid gap-1.5", !showAdvancedCompany && "hidden")}>
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
                <div className={cn("grid gap-1.5", !showAdvancedCompany && "hidden")}>
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
                  <Input
                    type="url"
                    value={website}
                    onChange={(e) => setWebsite(e.target.value)}
                    placeholder="https://…"
                  />
                </div>
                <div className="grid gap-1.5 sm:col-span-2">
                  <Label>Company LinkedIn URL</Label>
                  <Input
                    type="url"
                    value={companyLinkedin}
                    onChange={(e) => setCompanyLinkedin(e.target.value)}
                    placeholder="https://linkedin.com/company/…"
                  />
                </div>
                <div className={cn("grid gap-1.5", !showAdvancedCompany && "hidden")}>
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
                <div className={cn("grid gap-1.5", !showAdvancedCompany && "hidden")}>
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
                <div className={cn("grid gap-1.5", !showAdvancedCompany && "hidden")}>
                  <Label>Last website update / activity (date)</Label>
                  <Input type="date" value={lastSiteAt} onChange={(e) => setLastSiteAt(e.target.value)} />
                </div>
                <div className={cn("grid gap-1.5 sm:col-span-2", !showAdvancedCompany && "hidden")}>
                  <Label>Last website activity (observation)</Label>
                  <Textarea
                    value={lastSiteNote}
                    onChange={(e) => setLastSiteNote(e.target.value)}
                    rows={2}
                    className="resize-none"
                    placeholder="Notes if no exact date"
                  />
                </div>
                <div className={cn("grid gap-1.5 sm:col-span-2", !showAdvancedCompany && "hidden")}>
                  <Label>Tech stack / platform</Label>
                  <Input
                    value={techStackStr}
                    onChange={(e) => setTechStackStr(e.target.value)}
                    placeholder="WordPress, Shopify, Webflow, comma-separated"
                  />
                </div>
                <div className={cn("grid gap-1.5 sm:col-span-2", !showAdvancedCompany && "hidden")}>
                  <Label>Careers page URL</Label>
                  <Input
                    type="url"
                    value={careersUrl}
                    onChange={(e) => setCareersUrl(e.target.value)}
                    placeholder="https://…"
                  />
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
                  <Label>Seniority</Label>
                  <Input
                    value={seniority}
                    onChange={(e) => setSeniority(e.target.value)}
                    placeholder="Manager, Director, VP…"
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label>Contact location</Label>
                  <Input
                    value={contactLocation}
                    onChange={(e) => setContactLocation(e.target.value)}
                    placeholder="City, region or timezone"
                  />
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
                  <Input
                    type="url"
                    value={linkedin}
                    onChange={(e) => setLinkedin(e.target.value)}
                    placeholder="https://…"
                  />
                </div>
              </div>
            </section>

            <ProspectQualifyPanel
              state={qualifyForm}
              onChange={setQualifyForm}
              companyName={bizName}
              companyWebsite={website}
              contactName={`${firstName} ${lastName}`.trim()}
              contactTitle={title}
              contactLinkedIn={linkedin}
              emailVerified={emailVerify === "verified"}
              outreachThreshold={intentPlaybook.outreachThreshold}
              existingContactsForCompany={countCompanyContactsForUser(
                leads,
                currentUserId,
                domainFromWebsiteOrEmail(website, email),
                bizName,
              )}
              maxContactsPerCompany={maxContacts}
            />
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
