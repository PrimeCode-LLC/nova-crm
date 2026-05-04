"use client";

import * as React from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { PIPELINE_STAGES, PRIORITY_TONE, TEMPERATURE_TONE, COMPANY_SIZES, REVENUE_RANGES, CHANNEL_LIST } from "@/lib/constants";
import type {
  Account,
  ChannelKey,
  CompanySize,
  Contact,
  Followup,
  Lead,
  LeadPriority,
  LeadTemperature,
  PipelineStage,
  Profile,
  RevenueRange,
} from "@/lib/types";
import { useWorkspace } from "@/components/providers/workspace-mode-provider";
import { useAuth } from "@/components/providers/auth-provider";
import { useUserDoc } from "@/lib/hooks/use-user-doc";
import { useChannelAdminStore } from "@/stores/channel-admin-store";
import { getFirebaseDb } from "@/lib/firebase/client";
import { isFirebaseWebConfigured } from "@/lib/firebase/config";
import { persistLeadGraphClient } from "@/lib/firestore/persist-lead-graph-client";
import { isAuthDisabled } from "@/lib/auth/flags";
import { UserRound, Building2, Contact as ContactIcon, CheckSquare, User } from "lucide-react";

export type QuickAddPill = "lead" | "contact" | "account" | "task" | "profile";

type Pill = QuickAddPill;

const PROFILE_TYPES = ["upwork", "cv", "email", "linkedin"] as const;

const PILLS: { key: Pill; label: string; icon: React.ElementType }[] = [
  { key: "lead", label: "Lead", icon: UserRound },
  { key: "contact", label: "Contact", icon: ContactIcon },
  { key: "account", label: "Account", icon: Building2 },
  { key: "task", label: "Task", icon: CheckSquare },
  { key: "profile", label: "Profile", icon: User },
];

// ── Lead schema ──
const leadSchema = z.object({
  contactName: z.string().min(1, "Name required"),
  company: z.string().min(1, "Company required"),
  channel: z.string().min(1, "Channel required"),
  email: z.string().email("Invalid email").or(z.literal("")),
  stage: z.string().min(1, "Stage required"),
  ownerId: z.string().min(1, "Owner required"),
  estimatedValue: z.string().optional(),
  priority: z.string().min(1, "Priority required"),
  temperature: z.string().min(1, "Temperature required"),
});
type LeadForm = z.infer<typeof leadSchema>;

// ── Contact schema (link to existing account or create company inline) ──
const contactSchema = z
  .object({
    accountMode: z.enum(["existing", "new"]),
    accountId: z.string(),
    newCompanyName: z.string(),
    newCompanyDomain: z.string().optional(),
    firstName: z.string().min(1, "First name required"),
    lastName: z.string().min(1, "Last name required"),
    email: z.string().email("Invalid email").or(z.literal("")),
    phone: z.string().optional(),
    title: z.string().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.accountMode === "existing") {
      if (!data.accountId.trim()) {
        ctx.addIssue({ code: "custom", message: "Select an account", path: ["accountId"] });
      }
    } else if (!data.newCompanyName.trim()) {
      ctx.addIssue({ code: "custom", message: "Company name required", path: ["newCompanyName"] });
    }
  });
type ContactForm = z.infer<typeof contactSchema>;

function newEntityId(prefix: string): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}`;
}

function isoFromDateInput(dateStr: string): string {
  const d = new Date(`${dateStr}T12:00:00`);
  return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}

type ChannelOption = { key: string; label: string };

function buildChannelOptions(
  customChannels: { id: string; name: string }[],
): ChannelOption[] {
  return [
    ...CHANNEL_LIST.map((c) => ({ key: c.key, label: c.label })),
    ...customChannels
      .map((c) => ({ key: `custom_${c.id}`, label: c.name.trim() }))
      .filter((c) => c.label.length > 0),
  ];
}

function channelLabelFromValue(
  value: string | undefined,
  options: ChannelOption[],
): string {
  if (!value) return "";
  return options.find((o) => o.key === value)?.label ?? value;
}

// ── Account schema ──
const accountSchema = z.object({
  name: z.string().min(1, "Name required"),
  domain: z.string().optional(),
  industry: z.string().optional(),
  size: z.string().optional(),
  revenueRange: z.string().optional(),
});
type AccountForm = z.infer<typeof accountSchema>;

// ── Task schema ──
const taskSchema = z.object({
  title: z.string().min(1, "Title required"),
  leadId: z.string().optional(),
  dueDate: z.string().min(1, "Due date required"),
  priority: z.string().min(1, "Priority required"),
});
type TaskForm = z.infer<typeof taskSchema>;

// ── Profile quick form (outreach persona) ──
function ProfileQuickFormBody({ onClose }: { onClose: () => void }) {
  const { users, addProfile } = useWorkspace();
  const customChannels = useChannelAdminStore((s) => s.customChannels);
  const channelOptions = React.useMemo(
    () => buildChannelOptions(customChannels),
    [customChannels],
  );
  const [name, setName] = React.useState("");
  const [channel, setChannel] = React.useState<ChannelKey | "">("");
  const [type, setType] = React.useState("");
  const [ownerId, setOwnerId] = React.useState("");
  const [notes, setNotes] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const channelLabel = React.useMemo(
    () => channelLabelFromValue(channel, channelOptions),
    [channel, channelOptions],
  );

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const missing: string[] = [];
    if (!name.trim()) missing.push("name");
    if (!channel) missing.push("channel");
    if (!type) missing.push("type");
    if (!ownerId) missing.push("owner");
    if (missing.length) {
      toast.error(`Please add: ${missing.join(", ")}.`);
      return;
    }
    setSubmitting(true);
    const id =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? `p-${crypto.randomUUID()}`
        : `p-${Date.now()}`;
    addProfile({
      id,
      name: name.trim(),
      channel: channel as ChannelKey,
      type: type as Profile["type"],
      ownerId,
      active: true,
      notes: notes.trim() || undefined,
    });
    setSubmitting(false);
    toast.success(`Profile "${name.trim()}" created`);
    onClose();
  }

  return (
    <form onSubmit={(e) => void onSubmit(e)} className="space-y-3">
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-foreground">Profile name</label>
        <Input
          className="h-9"
          placeholder="e.g. Executive, LinkedIn outbound"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-foreground">Channel</label>
          <Select value={channel} onValueChange={(v) => setChannel((v ?? "") as ChannelKey)}>
            <SelectTrigger className="h-9">
              <SelectValue placeholder="Channel">{channelLabel || undefined}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {channelOptions.map((c) => (
                <SelectItem key={c.key} value={c.key}>
                  {c.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-foreground">Type</label>
          <Select value={type} onValueChange={(v) => setType(v ?? "")}>
            <SelectTrigger className="h-9">
              <SelectValue placeholder="Type" />
            </SelectTrigger>
            <SelectContent>
              {PROFILE_TYPES.map((t) => (
                <SelectItem key={t} value={t} className="capitalize">
                  {t}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-foreground">Owner</label>
        <Select value={ownerId} onValueChange={(v) => setOwnerId(v ?? "")}>
          <SelectTrigger className="h-9">
            <SelectValue placeholder="Owner" />
          </SelectTrigger>
          <SelectContent>
            {users.map((u) => (
              <SelectItem key={u.id} value={u.id}>
                {u.displayName}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-foreground">Notes (optional)</label>
        <Input
          className="h-9"
          placeholder="Short note…"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </div>
      <div className="flex justify-end gap-2 pt-1">
        <Button type="button" variant="ghost" size="sm" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={submitting}>
          {submitting ? "Creating…" : "Create profile"}
        </Button>
      </div>
    </form>
  );
}

// ── Sub-form components ──
function LeadFormBody({
  onClose,
  defaultStage = "new",
}: {
  onClose: () => void;
  defaultStage?: PipelineStage;
}) {
  const { users, currentUserId, addAccount, addContact, addLead, isDemo } = useWorkspace();
  const customChannels = useChannelAdminStore((s) => s.customChannels);
  const channelOptions = React.useMemo(
    () => buildChannelOptions(customChannels),
    [customChannels],
  );
  const { user: fbUser } = useAuth();
  const { data: liveUserDoc } = useUserDoc(
    isDemo || isAuthDisabled() || !fbUser ? undefined : fbUser.uid,
  );
  /** Live workspace snapshot often has no `users` / `currentUserId`; session gives the signed-in uid for owner + picker. */
  const [sessionOwnerId, setSessionOwnerId] = React.useState<string | null>(null);
  const [sessionOwnerLabel, setSessionOwnerLabel] = React.useState("");

  React.useEffect(() => {
    let cancelled = false;
    void fetch("/api/auth/me", { credentials: "same-origin", cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) return;
        const data = (await res.json()) as {
          user?: { uid?: string; email?: string; name?: string } | null;
        };
        if (cancelled || !data.user?.uid) return;
        setSessionOwnerId(data.user.uid);
        const label =
          data.user.name?.trim() ||
          data.user.email?.split("@")[0]?.trim() ||
          "You";
        setSessionOwnerLabel(label);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  type OwnerOption = { id: string; label: string };
  const ownerOptions = React.useMemo((): OwnerOption[] => {
    const list: OwnerOption[] = users.map((u) => ({
      id: u.id,
      label: u.displayName,
    }));
    if (sessionOwnerId && !list.some((o) => o.id === sessionOwnerId)) {
      list.push({
        id: sessionOwnerId,
        label: sessionOwnerLabel ? `${sessionOwnerLabel} (you)` : "You",
      });
    }
    return list;
  }, [users, sessionOwnerId, sessionOwnerLabel]);

  const form = useForm<LeadForm>({
    resolver: zodResolver(leadSchema),
    defaultValues: {
      contactName: "",
      company: "",
      channel: "",
      email: "",
      stage: defaultStage,
      ownerId: "",
      estimatedValue: "",
      priority: "medium",
      temperature: "cold",
    },
  });
  const selectedChannel = form.watch("channel");
  const selectedChannelLabel = React.useMemo(
    () => channelLabelFromValue(selectedChannel, channelOptions),
    [selectedChannel, channelOptions],
  );

  const defaultOwnerId =
    currentUserId || sessionOwnerId || users[0]?.id || "";

  React.useEffect(() => {
    if (!defaultOwnerId) return;
    const cur = form.getValues("ownerId");
    const valid = ownerOptions.some((o) => o.id === cur);
    if (!cur || !valid) {
      form.setValue("ownerId", defaultOwnerId);
    }
  }, [defaultOwnerId, ownerOptions, form]);

  async function onSubmit(values: LeadForm) {
    const ownerId = values.ownerId.trim();
    if (!ownerId) {
      toast.error("Could not assign owner. Try again after refresh.");
      return;
    }
    const now = new Date().toISOString();
    const accountId = newEntityId("a");
    const contactId = newEntityId("ct");
    const leadId = newEntityId("l");
    const nameParts = values.contactName.trim().split(/\s+/);
    const firstName = nameParts[0] ?? values.contactName.trim();
    const lastName = nameParts.slice(1).join(" ") || firstName;
    const fullName = values.contactName.trim();
    const emailTrim = values.email.trim();
    const estRaw = values.estimatedValue?.replace(/,/g, "").trim();
    const estimatedValue =
      estRaw && Number.isFinite(Number(estRaw)) && Number(estRaw) >= 0 ? Number(estRaw) : undefined;

    const account: Account = {
      id: accountId,
      name: values.company.trim(),
      contactCount: 0,
      leadCount: 1,
      openDealValue: 0,
      ownerId,
      createdAt: now,
      updatedAt: now,
    };
    const contact: Contact = {
      id: contactId,
      accountId,
      firstName,
      lastName,
      fullName,
      email: emailTrim || undefined,
      ownerId,
      createdAt: now,
      updatedAt: now,
    };
    const lead: Lead = {
      id: leadId,
      accountId,
      contactId,
      channel: values.channel as ChannelKey,
      stage: values.stage as PipelineStage,
      temperature: values.temperature as LeadTemperature,
      priority: values.priority as LeadPriority,
      ownerId,
      contactName: fullName,
      companyName: values.company.trim(),
      contactEmail: emailTrim || undefined,
      touches: 0,
      isIdle: false,
      estimatedValue,
      createdAt: now,
      updatedAt: now,
    };

    if (!isDemo && liveUserDoc?.organizationId && isFirebaseWebConfigured()) {
      try {
        const db = getFirebaseDb();
        await persistLeadGraphClient(db, liveUserDoc.organizationId, account, contact, lead);
        toast.success("Lead created");
        onClose();
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        toast.error(`Could not save lead: ${msg}`);
      }
      return;
    }

    addAccount(account);
    addContact(contact);
    addLead(lead);
    toast.success("Lead created");
    onClose();
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-0">
        {/*
          Single 6-column grid so field edges line up across rows:
          row1: 3+3 | row2: 2+4 | row3: 2+2+2 | row4: 2+4 (aligns with row2 & row3)
        */}
        <div className="grid grid-cols-6 gap-x-3 gap-y-4">
          <FormField control={form.control} name="contactName" render={({ field }) => (
            <FormItem className="col-span-6 min-w-0 sm:col-span-3">
              <FormLabel className="text-xs font-medium text-foreground">Contact name</FormLabel>
              <FormControl><Input className="h-9 min-w-0" placeholder="Jordan Harper" {...field} /></FormControl>
              <FormMessage className="text-xs" />
            </FormItem>
          )} />
          <FormField control={form.control} name="company" render={({ field }) => (
            <FormItem className="col-span-6 min-w-0 sm:col-span-3">
              <FormLabel className="text-xs font-medium text-foreground">Company</FormLabel>
              <FormControl><Input className="h-9 min-w-0" placeholder="Acme Inc." {...field} /></FormControl>
              <FormMessage className="text-xs" />
            </FormItem>
          )} />
          <FormField control={form.control} name="channel" render={({ field }) => (
            <FormItem className="col-span-6 min-w-0 sm:col-span-2">
              <FormLabel className="text-xs font-medium text-foreground">Channel</FormLabel>
              <Select value={field.value} onValueChange={field.onChange}>
                <FormControl><SelectTrigger className="h-9 w-full min-w-0"><SelectValue placeholder="Select channel">{selectedChannelLabel || undefined}</SelectValue></SelectTrigger></FormControl>
                <SelectContent>{channelOptions.map((c) => <SelectItem key={c.key} value={c.key}>{c.label}</SelectItem>)}</SelectContent>
              </Select>
              <FormMessage className="text-xs" />
            </FormItem>
          )} />
          <FormField control={form.control} name="email" render={({ field }) => (
            <FormItem className="col-span-6 min-w-0 sm:col-span-4">
              <FormLabel className="text-xs font-medium text-foreground">Email</FormLabel>
              <FormControl><Input type="email" className="h-9 min-w-0 pr-3" placeholder="contact@co.com" {...field} /></FormControl>
              <FormMessage className="text-xs" />
            </FormItem>
          )} />
          <FormField control={form.control} name="stage" render={({ field }) => (
            <FormItem className="col-span-6 min-w-0 sm:col-span-2">
              <FormLabel className="text-xs font-medium text-foreground">Stage</FormLabel>
              <Select value={field.value} onValueChange={field.onChange}>
                <FormControl><SelectTrigger className="h-9 w-full min-w-0"><SelectValue /></SelectTrigger></FormControl>
                <SelectContent>{PIPELINE_STAGES.map((s) => <SelectItem key={s.key} value={s.key}>{s.label}</SelectItem>)}</SelectContent>
              </Select>
              <FormMessage className="text-xs" />
            </FormItem>
          )} />
          <FormField control={form.control} name="priority" render={({ field }) => (
            <FormItem className="col-span-6 min-w-0 sm:col-span-2">
              <FormLabel className="text-xs font-medium text-foreground">Priority</FormLabel>
              <Select value={field.value} onValueChange={field.onChange}>
                <FormControl><SelectTrigger className="h-9 w-full min-w-0"><SelectValue /></SelectTrigger></FormControl>
                <SelectContent>{Object.entries(PRIORITY_TONE).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}</SelectContent>
              </Select>
              <FormMessage className="text-xs" />
            </FormItem>
          )} />
          <FormField control={form.control} name="temperature" render={({ field }) => (
            <FormItem className="col-span-6 min-w-0 sm:col-span-2">
              <FormLabel className="text-xs font-medium text-foreground">Temperature</FormLabel>
              <Select value={field.value} onValueChange={field.onChange}>
                <FormControl><SelectTrigger className="h-9 w-full min-w-0"><SelectValue /></SelectTrigger></FormControl>
                <SelectContent>{Object.entries(TEMPERATURE_TONE).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}</SelectContent>
              </Select>
              <FormMessage className="text-xs" />
            </FormItem>
          )} />
          <FormField control={form.control} name="ownerId" render={({ field }) => (
            <FormItem className="col-span-6 min-w-0 sm:col-span-2">
              <FormLabel className="text-xs font-medium text-foreground">Owner</FormLabel>
              <Select value={field.value} onValueChange={field.onChange}>
                <FormControl><SelectTrigger className="h-9 w-full min-w-0"><SelectValue placeholder="You (default)" /></SelectTrigger></FormControl>
                <SelectContent>
                  {ownerOptions.length === 0 ? (
                    <div className="px-2 py-1.5 text-xs text-muted-foreground">
                      Loading team…
                    </div>
                  ) : (
                    ownerOptions.map((o) => (
                      <SelectItem key={o.id} value={o.id}>
                        {o.label}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
              <FormMessage className="text-xs" />
            </FormItem>
          )} />
          <FormField control={form.control} name="estimatedValue" render={({ field }) => (
            <FormItem className="col-span-6 min-w-0 sm:col-span-4">
              <FormLabel className="text-xs font-medium text-foreground">Est. value (USD)</FormLabel>
              <FormControl><Input type="number" className="h-9 min-w-0 tabular-nums pr-3" placeholder="0" {...field} /></FormControl>
              <FormMessage className="text-xs" />
            </FormItem>
          )} />
        </div>
        <div className="flex justify-end gap-2 border-t border-border/60 pt-4 mt-4">
          <Button type="button" variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
          <Button type="submit" size="sm" disabled={form.formState.isSubmitting}>
            {form.formState.isSubmitting ? "Creating…" : "Create lead"}
          </Button>
        </div>
      </form>
    </Form>
  );
}

function ContactFormBody({ onClose }: { onClose: () => void }) {
  const { accounts, addAccount, addContact, currentUserId, users } = useWorkspace();
  const form = useForm<ContactForm>({
    resolver: zodResolver(contactSchema),
    defaultValues: {
      accountMode: "existing",
      accountId: "",
      newCompanyName: "",
      newCompanyDomain: "",
      firstName: "",
      lastName: "",
      email: "",
      phone: "",
      title: "",
    },
  });
  const accountMode = form.watch("accountMode");

  React.useEffect(() => {
    if (accounts.length === 0) {
      form.setValue("accountMode", "new");
    }
  }, [accounts.length, form]);

  async function onSubmit(values: ContactForm) {
    const ownerId = currentUserId || users[0]?.id;
    if (!ownerId) {
      toast.error("Could not assign owner. Try again after refresh.");
      return;
    }
    const now = new Date().toISOString();
    let accountId = values.accountId.trim();
    if (values.accountMode === "new") {
      accountId = newEntityId("a");
      addAccount({
        id: accountId,
        name: values.newCompanyName.trim(),
        domain: values.newCompanyDomain?.trim() || undefined,
        contactCount: 0,
        leadCount: 0,
        openDealValue: 0,
        ownerId,
        createdAt: now,
        updatedAt: now,
      });
    }
    const fn = values.firstName.trim();
    const ln = values.lastName.trim();
    addContact({
      id: newEntityId("ct"),
      accountId,
      firstName: fn,
      lastName: ln,
      fullName: `${fn} ${ln}`.trim(),
      email: values.email.trim() || undefined,
      phone: values.phone?.trim() || undefined,
      title: values.title?.trim() || undefined,
      ownerId,
      createdAt: now,
      updatedAt: now,
    });
    toast.success("Contact created");
    onClose();
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-3">
        <FormField
          control={form.control}
          name="accountMode"
          render={({ field }) => (
            <FormItem className="space-y-2">
              <FormLabel className="text-xs font-medium text-foreground">Company</FormLabel>
              <FormControl>
                <RadioGroup
                  value={field.value}
                  onValueChange={(v) => {
                    const mode = v as ContactForm["accountMode"];
                    field.onChange(mode);
                    if (mode === "existing") {
                      form.setValue("newCompanyName", "");
                      form.setValue("newCompanyDomain", "");
                    } else {
                      form.setValue("accountId", "");
                    }
                  }}
                  className="grid grid-cols-2 gap-2"
                >
                  <div>
                    <RadioGroupItem
                      value="existing"
                      id="contact-acc-existing"
                      className="sr-only"
                      disabled={accounts.length === 0}
                    />
                    <Label
                      htmlFor="contact-acc-existing"
                      className={`flex items-center justify-center rounded-lg border px-2 py-2 text-center text-xs font-medium transition-colors ${
                        accounts.length === 0
                          ? "cursor-not-allowed border-border/40 text-muted-foreground/50"
                          : `cursor-pointer ${
                              field.value === "existing"
                                ? "border-primary bg-primary/5 text-primary"
                                : "border-border/60 text-muted-foreground hover:bg-muted/40"
                            }`
                      }`}
                    >
                      Existing account
                    </Label>
                  </div>
                  <div>
                    <RadioGroupItem value="new" id="contact-acc-new" className="sr-only" />
                    <Label
                      htmlFor="contact-acc-new"
                      className={`flex cursor-pointer items-center justify-center rounded-lg border px-2 py-2 text-center text-xs font-medium transition-colors ${
                        field.value === "new"
                          ? "border-primary bg-primary/5 text-primary"
                          : "border-border/60 text-muted-foreground hover:bg-muted/40"
                      }`}
                    >
                      New company
                    </Label>
                  </div>
                </RadioGroup>
              </FormControl>
              <FormMessage className="text-xs" />
            </FormItem>
          )}
        />

        {accountMode === "existing" ? (
          <FormField
            control={form.control}
            name="accountId"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-xs">Account</FormLabel>
                <Select value={field.value} onValueChange={field.onChange}>
                  <FormControl>
                    <SelectTrigger className="h-9">
                      <SelectValue placeholder="Select account" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {accounts.map((a) => (
                      <SelectItem key={a.id} value={a.id}>
                        {a.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage className="text-xs" />
              </FormItem>
            )}
          />
        ) : (
          <div className="grid grid-cols-2 gap-3">
            <FormField
              control={form.control}
              name="newCompanyName"
              render={({ field }) => (
                <FormItem className="col-span-2 sm:col-span-1">
                  <FormLabel className="text-xs">Company name</FormLabel>
                  <FormControl>
                    <Input className="h-9" placeholder="Acme Inc." {...field} />
                  </FormControl>
                  <FormMessage className="text-xs" />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="newCompanyDomain"
              render={({ field }) => (
                <FormItem className="col-span-2 sm:col-span-1">
                  <FormLabel className="text-xs">Domain (optional)</FormLabel>
                  <FormControl>
                    <Input className="h-9" placeholder="acme.com" {...field} />
                  </FormControl>
                  <FormMessage className="text-xs" />
                </FormItem>
              )}
            />
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <FormField
            control={form.control}
            name="firstName"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-xs">First name</FormLabel>
                <FormControl>
                  <Input className="h-9" placeholder="Jordan" {...field} />
                </FormControl>
                <FormMessage className="text-xs" />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="lastName"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-xs">Last name</FormLabel>
                <FormControl>
                  <Input className="h-9" placeholder="Harper" {...field} />
                </FormControl>
                <FormMessage className="text-xs" />
              </FormItem>
            )}
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <FormField
            control={form.control}
            name="email"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-xs">Email</FormLabel>
                <FormControl>
                  <Input type="email" className="h-9" placeholder="jordan@co.com" {...field} />
                </FormControl>
                <FormMessage className="text-xs" />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="phone"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-xs">Phone</FormLabel>
                <FormControl>
                  <Input className="h-9" placeholder="+1 555-0100" {...field} />
                </FormControl>
                <FormMessage className="text-xs" />
              </FormItem>
            )}
          />
        </div>
        <FormField
          control={form.control}
          name="title"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="text-xs">Title</FormLabel>
              <FormControl>
                <Input className="h-9" placeholder="CEO" {...field} />
              </FormControl>
              <FormMessage className="text-xs" />
            </FormItem>
          )}
        />
        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" size="sm" disabled={form.formState.isSubmitting}>
            {form.formState.isSubmitting ? "Creating…" : "Create contact"}
          </Button>
        </div>
      </form>
    </Form>
  );
}

function AccountFormBody({ onClose }: { onClose: () => void }) {
  const { addAccount, currentUserId, users } = useWorkspace();
  const form = useForm<AccountForm>({
    resolver: zodResolver(accountSchema),
    defaultValues: { name: "", domain: "", industry: "", size: "", revenueRange: "" },
  });

  function onSubmit(v: AccountForm) {
    const ownerId = currentUserId || users[0]?.id;
    if (!ownerId) {
      toast.error("Could not assign owner. Try again after refresh.");
      return;
    }
    const now = new Date().toISOString();
    addAccount({
      id: newEntityId("a"),
      name: v.name.trim(),
      domain: v.domain?.trim() || undefined,
      industry: v.industry?.trim() || undefined,
      size: (v.size as CompanySize) || undefined,
      revenueRange: (v.revenueRange as RevenueRange) || undefined,
      contactCount: 0,
      leadCount: 0,
      openDealValue: 0,
      ownerId,
      createdAt: now,
      updatedAt: now,
    });
    toast.success("Account created");
    onClose();
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <FormField control={form.control} name="name" render={({ field }) => (
            <FormItem>
              <FormLabel className="text-xs">Company name</FormLabel>
              <FormControl><Input className="h-9" placeholder="Acme Inc." {...field} /></FormControl>
              <FormMessage className="text-xs" />
            </FormItem>
          )} />
          <FormField control={form.control} name="domain" render={({ field }) => (
            <FormItem>
              <FormLabel className="text-xs">Domain</FormLabel>
              <FormControl><Input className="h-9" placeholder="acme.com" {...field} /></FormControl>
              <FormMessage className="text-xs" />
            </FormItem>
          )} />
        </div>
        <FormField control={form.control} name="industry" render={({ field }) => (
          <FormItem>
            <FormLabel className="text-xs">Industry</FormLabel>
            <FormControl><Input className="h-9" placeholder="SaaS, Fintech, Healthcare…" {...field} /></FormControl>
            <FormMessage className="text-xs" />
          </FormItem>
        )} />
        <div className="grid grid-cols-2 gap-3">
          <FormField control={form.control} name="size" render={({ field }) => (
            <FormItem>
              <FormLabel className="text-xs">Company size</FormLabel>
              <Select value={field.value} onValueChange={field.onChange}>
                <FormControl><SelectTrigger className="h-9"><SelectValue placeholder="Size" /></SelectTrigger></FormControl>
                <SelectContent>{COMPANY_SIZES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
              </Select>
              <FormMessage className="text-xs" />
            </FormItem>
          )} />
          <FormField control={form.control} name="revenueRange" render={({ field }) => (
            <FormItem>
              <FormLabel className="text-xs">Revenue range</FormLabel>
              <Select value={field.value} onValueChange={field.onChange}>
                <FormControl><SelectTrigger className="h-9"><SelectValue placeholder="Revenue" /></SelectTrigger></FormControl>
                <SelectContent>{Object.entries(REVENUE_RANGES).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
              </Select>
              <FormMessage className="text-xs" />
            </FormItem>
          )} />
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
          <Button type="submit" size="sm" disabled={form.formState.isSubmitting}>
            {form.formState.isSubmitting ? "Creating…" : "Create account"}
          </Button>
        </div>
      </form>
    </Form>
  );
}

function TaskFormBody({ onClose }: { onClose: () => void }) {
  const { leads, addFollowup, currentUserId, users } = useWorkspace();
  const form = useForm<TaskForm>({
    resolver: zodResolver(taskSchema),
    defaultValues: { title: "", leadId: "", dueDate: new Date().toISOString().slice(0, 10), priority: "medium" },
  });

  function onSubmit(v: TaskForm) {
    const ownerId = currentUserId || users[0]?.id;
    if (!ownerId) {
      toast.error("Could not assign owner. Try again after refresh.");
      return;
    }
    const title = v.title.trim();
    if (!title) {
      toast.error("Enter a task title.");
      return;
    }
    const followup: Followup = {
      id: newEntityId("f"),
      leadId: (v.leadId ?? "").trim() || undefined,
      title,
      dueAt: isoFromDateInput(v.dueDate),
      ownerId,
      priority: v.priority as LeadPriority,
      auto: false,
    };
    addFollowup(followup);
    toast.success("Task created");
    onClose();
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-3">
        <FormField control={form.control} name="title" render={({ field }) => (
          <FormItem>
            <FormLabel className="text-xs">Task title</FormLabel>
            <FormControl><Input className="h-9" placeholder="Send proposal to…" {...field} /></FormControl>
            <FormMessage className="text-xs" />
          </FormItem>
        )} />
        <FormField control={form.control} name="leadId" render={({ field }) => (
          <FormItem>
            <FormLabel className="text-xs">Related lead (optional)</FormLabel>
            <Select value={field.value} onValueChange={field.onChange}>
              <FormControl><SelectTrigger className="h-9"><SelectValue placeholder="No lead" /></SelectTrigger></FormControl>
              <SelectContent>
                <SelectItem value="">None</SelectItem>
                {leads.slice(0, 15).map((l) => (
                  <SelectItem key={l.id} value={l.id}>
                    {l.contactName} · {l.companyName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FormMessage className="text-xs" />
          </FormItem>
        )} />
        <div className="grid grid-cols-2 gap-3">
          <FormField control={form.control} name="dueDate" render={({ field }) => (
            <FormItem>
              <FormLabel className="text-xs">Due date</FormLabel>
              <FormControl><Input type="date" className="h-9" {...field} /></FormControl>
              <FormMessage className="text-xs" />
            </FormItem>
          )} />
          <FormField control={form.control} name="priority" render={({ field }) => (
            <FormItem>
              <FormLabel className="text-xs">Priority</FormLabel>
              <Select value={field.value} onValueChange={field.onChange}>
                <FormControl><SelectTrigger className="h-9"><SelectValue /></SelectTrigger></FormControl>
                <SelectContent>{Object.entries(PRIORITY_TONE).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}</SelectContent>
              </Select>
              <FormMessage className="text-xs" />
            </FormItem>
          )} />
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
          <Button type="submit" size="sm" disabled={form.formState.isSubmitting}>
            {form.formState.isSubmitting ? "Creating…" : "Create task"}
          </Button>
        </div>
      </form>
    </Form>
  );
}

// ── Main dialog ──
export function QuickAddDialog({
  open,
  onOpenChange,
  initialPill = "lead",
  initialLeadStage,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  initialPill?: QuickAddPill;
  initialLeadStage?: PipelineStage;
}) {
  const [pill, setPill] = React.useState<Pill>(initialPill);
  const [leadFormSession, setLeadFormSession] = React.useState(0);

  React.useEffect(() => {
    if (open) {
      setPill(initialPill);
      setLeadFormSession((s) => s + 1);
    }
  }, [open, initialPill]);

  function handleClose() {
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl gap-4 sm:max-w-xl">
        <DialogHeader className="text-left">
          <DialogTitle className="text-base font-semibold tracking-tight">Quick add</DialogTitle>
        </DialogHeader>
        <div
          className="grid grid-cols-2 gap-1 rounded-lg border border-border/50 bg-muted/40 p-1 sm:grid-cols-5"
          role="tablist"
          aria-label="Record type"
        >
          {PILLS.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={pill === key}
              onClick={() => setPill(key)}
              className={`flex min-w-0 flex-col items-center justify-center gap-1 rounded-md px-1.5 py-2.5 text-center text-xs font-medium leading-snug transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background sm:px-2 sm:text-sm ${
                pill === key
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Icon className="h-4 w-4 shrink-0" aria-hidden />
              <span className="w-full max-w-full whitespace-normal break-words">{label}</span>
            </button>
          ))}
        </div>
        <div className="mt-1">
          {pill === "lead" && (
            <LeadFormBody
              key={`${leadFormSession}-${initialLeadStage ?? ""}`}
              onClose={handleClose}
              defaultStage={initialLeadStage ?? "new"}
            />
          )}
          {pill === "contact" && <ContactFormBody onClose={handleClose} />}
          {pill === "account" && <AccountFormBody onClose={handleClose} />}
          {pill === "task" && <TaskFormBody onClose={handleClose} />}
          {pill === "profile" && <ProfileQuickFormBody onClose={handleClose} />}
        </div>
      </DialogContent>
    </Dialog>
  );
}
