"use client";

import * as React from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionHeader,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { isEmailAccountConfigured, useEmailAccountStore } from "@/stores/email-account-store";
import type { EmailMailboxSettings, MailboxConnectionType } from "@/lib/email-account-types";
import { isAssignedMailbox } from "@/lib/email-account-types";
import {
  GOOGLE_WORKSPACE_DEFAULT_DAILY_SEND_LIMIT,
  MICROSOFT_OUTLOOK_DEFAULT_DAILY_SEND_LIMIT,
  applyGoogleWorkspacePreset,
  applyMicrosoftOutlookPreset,
  withGoogleWorkspaceConnection,
  withMicrosoftOutlookConnection,
} from "@/lib/email/mailbox-connection-presets";
import { normalizeMailHost } from "@/lib/email/normalize-mail-host";
import { normalizeCrmEmailKey } from "@/lib/crm-dedup-keys";
import { toast } from "sonner";
import {
  Ban,
  CheckCircle2,
  Eye,
  EyeOff,
  FileText,
  Gauge,
  Loader2,
  Mail,
  PenLine,
  PlugZap,
  ShieldAlert,
  Plus,
  Save,
  Trash2,
  Unplug,
  Users,
} from "lucide-react";
import { useWorkspace } from "@/components/providers/workspace-mode-provider";
import { buildWorkspaceOwnerPickerOptions, ownerPickerTriggerLabel } from "@/lib/owner-scope";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { OrganizationMember, User } from "@/lib/types";
import { cn } from "@/lib/utils";

/** Another owned mailbox already using this From address (case-insensitive). */
function findDuplicateMailboxByEmail(
  mailboxes: readonly EmailMailboxSettings[],
  emailAddress: string,
  excludeMailboxId: string,
): EmailMailboxSettings | undefined {
  const key = normalizeCrmEmailKey(emailAddress);
  if (!key) return undefined;
  return mailboxes.find((m) => {
    if (m.id === excludeMailboxId) return false;
    return normalizeCrmEmailKey(m.emailAddress) === key;
  });
}

/** Transport ready: Google OAuth for Workspace, otherwise SMTP host set. */
function isMailboxTransportConnected(mb: EmailMailboxSettings): boolean {
  if (mb.connectionType === "google_workspace") {
    return Boolean(mb.googleAuthConnected);
  }
  return Boolean(mb.emailAddress.trim() && normalizeMailHost(mb.smtp.host));
}

/** Active teammates only — skips disabled/inactive/invited org members and inactive CRM users. */
function buildActiveAssignableOptions(
  users: readonly User[],
  members: readonly OrganizationMember[] | null,
  currentUserId: string,
  getOwnerDisplayName: (id: string) => string | undefined,
): { id: string; label: string }[] {
  const opts: { id: string; label: string }[] = [];
  if (members) {
    const uidToUser = new Map(users.map((u) => [u.id, u]));
    for (const m of members) {
      if (m.status !== "active") continue;
      if (!m.uid || m.uid === currentUserId) continue;
      const u = uidToUser.get(m.uid);
      if (u && u.status !== "active") continue;
      const label =
        m.displayName?.trim() ||
        u?.displayName?.trim() ||
        getOwnerDisplayName(m.uid)?.trim() ||
        (m.email.includes("@") ? m.email.split("@")[0] : m.email) ||
        u?.email.split("@")[0] ||
        m.uid;
      opts.push({ id: m.uid, label });
    }
  } else {
    for (const u of users) {
      if (u.status !== "active") continue;
      if (!u.id || u.id === currentUserId) continue;
      const label =
        u.displayName?.trim() ||
        getOwnerDisplayName(u.id)?.trim() ||
        u.email.split("@")[0] ||
        u.id;
      opts.push({ id: u.id, label });
    }
  }
  return opts.sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: "base" }));
}

function assignTeammateTriggerLabel(
  uid: string | undefined,
  options: readonly { id: string; label: string }[],
  assignedInboxCounts: ReadonlyMap<string, number>,
  resolveFallback: (id: string) => string | undefined,
): string | null {
  const id = uid?.trim() ?? "";
  if (!id) return null;
  const opt = options.find((o) => o.id === id);
  if (opt) return `${opt.label} (${assignedInboxCounts.get(id) ?? 0})`;
  return resolveFallback(id) ?? ownerPickerTriggerLabel(id, options);
}

type StatusTone = "ok" | "warn" | "muted";

function MailboxStatusChip({
  tone,
  icon: Icon,
  label,
  tooltip,
}: {
  tone: StatusTone;
  icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  label?: string;
  tooltip: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            className={cn(
              "inline-flex h-6 shrink-0 items-center gap-1 rounded-md border px-1.5 text-[10px] font-medium tabular-nums",
              tone === "ok" && "border-success/25 bg-success/10 text-success",
              tone === "warn" && "border-warning/25 bg-warning/10 text-warning",
              tone === "muted" && "border-border bg-muted/40 text-muted-foreground",
            )}
            onClick={(e) => e.stopPropagation()}
          >
            <Icon className="h-3 w-3" aria-hidden />
            {label ? <span>{label}</span> : null}
          </span>
        }
      />
      <TooltipContent side="top">{tooltip}</TooltipContent>
    </Tooltip>
  );
}

function MailboxQuickStatus({
  mailbox,
  sendUsage,
}: {
  mailbox: EmailMailboxSettings;
  sendUsage?: { used: number; limit: number | null };
}) {
  const connected = isMailboxTransportConnected(mailbox);
  const assignedCount = (mailbox.assignedUserIds ?? []).length;
  const hasSignature = Boolean(mailbox.signature?.trim());
  const limit = mailbox.dailySendLimit;
  const used = sendUsage?.used ?? 0;
  const limitNear =
    limit != null && limit > 0 && used / limit >= 0.9;

  const connectedTooltip = connected
    ? mailbox.connectionType === "google_workspace"
      ? "Google OAuth connected"
      : "SMTP host configured"
    : mailbox.connectionType === "google_workspace"
      ? "Google not connected — sign in required"
      : "SMTP not configured yet";

  const limitLabel = limit == null ? "∞" : String(limit);
  const limitTooltip =
    limit == null
      ? "No daily send limit"
      : limitNear
        ? `Daily limit nearly reached (${used}/${limit})`
        : `Daily send limit: ${used > 0 ? `${used}/` : ""}${limit}`;

  return (
    <div
      className="flex shrink-0 flex-wrap items-center justify-end gap-1"
      aria-label="Mailbox setup overview"
    >
      <MailboxStatusChip
        tone={connected ? "ok" : "warn"}
        icon={connected ? CheckCircle2 : Unplug}
        tooltip={connectedTooltip}
      />
      <MailboxStatusChip
        tone={assignedCount > 0 ? "ok" : "muted"}
        icon={Users}
        label={assignedCount > 0 ? String(assignedCount) : undefined}
        tooltip={
          assignedCount > 0
            ? `Assigned to ${assignedCount} teammate${assignedCount === 1 ? "" : "s"}`
            : "No teammates assigned"
        }
      />
      <MailboxStatusChip
        tone={limitNear ? "warn" : limit != null ? "ok" : "muted"}
        icon={Gauge}
        label={limitLabel}
        tooltip={limitTooltip}
      />
      <MailboxStatusChip
        tone={hasSignature ? "ok" : "warn"}
        icon={PenLine}
        tooltip={hasSignature ? "Signature set" : "No signature yet"}
      />
    </div>
  );
}

export function EmailInboxSettingsCard() {
  const { users, currentUserId, isDemo, getOwnerDisplayName } = useWorkspace();
  const mailboxes = useEmailAccountStore((s) => s.mailboxes);
  const activeMailboxId = useEmailAccountStore((s) => s.activeMailboxId);
  const setActiveMailbox = useEmailAccountStore((s) => s.setActiveMailbox);
  const addMailbox = useEmailAccountStore((s) => s.addMailbox);
  const removeMailbox = useEmailAccountStore((s) => s.removeMailbox);
  const updateMailbox = useEmailAccountStore((s) => s.updateMailbox);
  const setSmtp = useEmailAccountStore((s) => s.setSmtp);
  const setImap = useEmailAccountStore((s) => s.setImap);
  const emailServerHydrated = useEmailAccountStore((s) => s.emailServerHydrated);
  const emailServerSyncEnabled = useEmailAccountStore((s) => s.emailServerSyncEnabled);
  const blockedSenderDomains = useEmailAccountStore((s) => s.blockedSenderDomains);
  const removeBlockedSenderDomain = useEmailAccountStore((s) => s.removeBlockedSenderDomain);
  const globalEmailFooter = useEmailAccountStore((s) => s.globalEmailFooter);
  const setGlobalEmailFooter = useEmailAccountStore((s) => s.setGlobalEmailFooter);
  const sortedBlockedDomains = React.useMemo(
    () => [...blockedSenderDomains].sort((a, b) => a.localeCompare(b)),
    [blockedSenderDomains],
  );
  const [footerDraft, setFooterDraft] = React.useState(globalEmailFooter);
  const [footerSaving, setFooterSaving] = React.useState(false);

  React.useEffect(() => {
    setFooterDraft(globalEmailFooter);
  }, [globalEmailFooter]);

  const footerDirty = footerDraft !== globalEmailFooter;

  function saveGlobalFooter() {
    if (isDemo) {
      toast.message("Email footer is not saved in demo mode.");
      setGlobalEmailFooter(footerDraft);
      return;
    }
    setFooterSaving(true);
    setGlobalEmailFooter(footerDraft);
    // Meta persist is debounced in the store; give light feedback.
    window.setTimeout(() => {
      setFooterSaving(false);
      toast.success("Email footer saved");
    }, 200);
  }
  const [savingRemote, setSavingRemote] = React.useState(false);
  const [testingMailboxId, setTestingMailboxId] = React.useState<string | null>(null);
  const [openValues, setOpenValues] = React.useState<string[]>([]);
  /** `${mailboxId}:smtp` | `${mailboxId}:imap` → password field visible as plain text */
  const [passwordFieldVisible, setPasswordFieldVisible] = React.useState<Record<string, boolean>>({});
  const [assignPickByMailbox, setAssignPickByMailbox] = React.useState<Record<string, string>>({});
  const [sendUsageByMailboxId, setSendUsageByMailboxId] = React.useState<
    Record<string, { used: number; limit: number | null }>
  >({});
  /** `null` until live org members load (demo uses CRM users only). */
  const [orgMembers, setOrgMembers] = React.useState<OrganizationMember[] | null>(null);

  const ownedMailboxes = React.useMemo(
    () => mailboxes.filter((m) => !isAssignedMailbox(m, currentUserId)),
    [mailboxes, currentUserId],
  );

  const mailboxOverviewStats = React.useMemo(() => {
    let connected = 0;
    let enabled = 0;
    let withSignature = 0;
    let withAssignees = 0;
    for (const mb of ownedMailboxes) {
      if (isMailboxTransportConnected(mb)) connected += 1;
      if (mb.enabled) enabled += 1;
      if (mb.signature?.trim()) withSignature += 1;
      if ((mb.assignedUserIds ?? []).length > 0) withAssignees += 1;
    }
    return {
      total: ownedMailboxes.length,
      connected,
      enabled,
      withSignature,
      withAssignees,
      needsAttention: ownedMailboxes.filter(
        (mb) => !isMailboxTransportConnected(mb) || !mb.signature?.trim(),
      ).length,
    };
  }, [ownedMailboxes]);

  const assignedInboxCountByUserId = React.useMemo(() => {
    const counts = new Map<string, number>();
    for (const mb of ownedMailboxes) {
      for (const uid of mb.assignedUserIds ?? []) {
        counts.set(uid, (counts.get(uid) ?? 0) + 1);
      }
    }
    return counts;
  }, [ownedMailboxes]);

  const activeAssignableOptions = React.useMemo(
    () =>
      buildActiveAssignableOptions(
        users,
        isDemo ? null : orgMembers,
        currentUserId,
        getOwnerDisplayName,
      ),
    [users, isDemo, orgMembers, currentUserId, getOwnerDisplayName],
  );

  const granteeLabels = React.useMemo(() => {
    const map = new Map<string, string>();
    for (const o of activeAssignableOptions) map.set(o.id, o.label);
    for (const o of buildWorkspaceOwnerPickerOptions(users, currentUserId, getOwnerDisplayName)) {
      if (!map.has(o.id)) map.set(o.id, o.label);
    }
    return map;
  }, [activeAssignableOptions, users, currentUserId, getOwnerDisplayName]);

  React.useEffect(() => {
    if (isDemo) {
      setOrgMembers(null);
      setSendUsageByMailboxId({});
      return;
    }
    let cancelled = false;
    void fetch("/api/org/members", { credentials: "same-origin", cache: "no-store" })
      .then(async (res) => {
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as { members?: OrganizationMember[] };
        if (!cancelled) setOrgMembers(data.members ?? []);
      })
      .catch(() => {
        if (!cancelled) setOrgMembers(null);
      });
    return () => {
      cancelled = true;
    };
  }, [isDemo]);

  React.useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const connected = params.get("google_mail_connected");
    const err = params.get("google_mail_error");
    const warning = params.get("google_mail_warning");
    if (!connected && !err) return;

    if (connected) {
      toast.success("Google Workspace mailbox connected", {
        description:
          warning === "no_refresh"
            ? "Connected, but Google did not return a refresh token. Reconnect with consent if mail stops working."
            : "OAuth tokens saved. Run Test connection, then Enable mail.",
      });
    } else if (err) {
      const messages: Record<string, string> = {
        not_configured: "Google OAuth is not configured on the server.",
        invalid_state: "OAuth state was invalid. Try Sign in with Google again.",
        token_exchange: "Google token exchange failed. Check client id/secret and redirect URI.",
        no_email: "Google did not return an account email.",
        vault: "Could not store OAuth tokens (check EMAIL_SECRETS_KEY_BASE64).",
      };
      toast.error("Google mail connection failed", {
        description: messages[err] ?? err,
      });
    }

    window.history.replaceState({}, "", `${window.location.pathname}?tab=email`);
  }, []);

  const persistKey = React.useMemo(
    () => JSON.stringify(ownedMailboxes),
    [ownedMailboxes],
  );

  /**
   * Baseline snapshot after hydrate. Auto-save only runs when `persistKey` diverges from this
   * (user edits). Prevents a race where the first post-hydrate persist (or effect cleanup)
   * writes an empty/default mailbox and wipes fields like signature on the server.
   */
  const persistBaselineRef = React.useRef<string | null>(null);
  const persistDirtyRef = React.useRef(false);
  const latestPersistKeyRef = React.useRef(persistKey);
  latestPersistKeyRef.current = persistKey;

  /**
   * Persists owned mailboxes to the server (skips boxes assigned from teammates).
   * @param manual — when true, shows success/error toasts and surfaces “not ready” as an error instead of no-op.
   */
  const persistMailboxesRemote = React.useCallback(async (manual?: boolean): Promise<boolean> => {
    const s = useEmailAccountStore.getState();
    if (!s.emailServerSyncEnabled || !s.emailServerHydrated) {
      if (manual) {
        toast.error("Could not save email settings", {
          description: !s.emailServerHydrated
            ? "Your mailboxes are still loading. Wait a moment, then try again."
            : "Saving is unavailable, check your connection or sign in again. If this persists, reload the page.",
        });
      }
      return false;
    }
    const all = s.mailboxes.filter((m) => !isAssignedMailbox(m, currentUserId));
    const seenEmails = new Map<string, string>();
    for (const mb of all) {
      const key = normalizeCrmEmailKey(mb.emailAddress);
      if (!key) continue;
      const priorLabel = seenEmails.get(key);
      if (priorLabel !== undefined) {
        const msg = `${mb.emailAddress.trim()} is already added on “${priorLabel}”. Use a different address.`;
        toast.error(manual ? "Duplicate mailbox email" : "Duplicate mailbox email", {
          description: msg,
        });
        return false;
      }
      seenEmails.set(key, mb.label?.trim() || mb.emailAddress.trim() || "Mailbox");
    }
    setSavingRemote(true);
    try {
      for (const mb of all) {
        const res = await fetch("/api/email/mailboxes", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({
            mailbox: {
              ...mb,
              // Always send a string so Zod + Firestore never see `undefined`.
              signature: typeof mb.signature === "string" ? mb.signature : "",
            },
          }),
        });
        let data: { ok?: boolean; error?: string } = {};
        try {
          data = (await res.json()) as { ok?: boolean; error?: string };
        } catch {
          data = {};
        }
        if (!res.ok || !data.ok) {
          const msg =
            data.error ??
            (res.status >= 500
              ? "Server error while saving."
              : res.status === 401 || res.status === 403
                ? "You are not allowed to save these settings."
                : `Save failed (${res.status}).`);
          toast.error(manual ? "Could not save email settings" : "Failed to save mailbox", {
            description: msg,
          });
          return false;
        }
      }
      persistBaselineRef.current = latestPersistKeyRef.current;
      persistDirtyRef.current = false;
      if (manual) {
        toast.success("Email settings saved");
      }
      return true;
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Network error";
      toast.error(manual ? "Could not save email settings" : "Could not save mailbox", {
        description: msg,
      });
      return false;
    } finally {
      setSavingRemote(false);
    }
  }, [currentUserId]);

  React.useEffect(() => {
    // Avoid opening the store's placeholder "Primary mailbox" before server hydrate.
    if (!isDemo && !emailServerHydrated) {
      setOpenValues([]);
      return;
    }
    if (ownedMailboxes.length === 0) {
      setOpenValues([]);
      return;
    }
    setOpenValues((prev) => {
      const valid = prev.filter((id) => ownedMailboxes.some((m) => m.id === id));
      // Prefer the active inbox mailbox so the signature field matches what compose uses.
      if (activeMailboxId && ownedMailboxes.some((m) => m.id === activeMailboxId)) {
        if (valid.includes(activeMailboxId)) return valid;
        return [...valid, activeMailboxId];
      }
      if (valid.length > 0) return valid;
      return [ownedMailboxes[0]!.id];
    });
  }, [ownedMailboxes, activeMailboxId, isDemo, emailServerHydrated]);

  // Capture hydrate baseline; do not auto-save until the user changes something.
  React.useEffect(() => {
    if (!emailServerSyncEnabled || !emailServerHydrated) {
      persistBaselineRef.current = null;
      persistDirtyRef.current = false;
      return;
    }
    if (persistBaselineRef.current === null) {
      persistBaselineRef.current = persistKey;
      persistDirtyRef.current = false;
      return;
    }
    if (persistKey !== persistBaselineRef.current) {
      persistDirtyRef.current = true;
    }
  }, [persistKey, emailServerHydrated, emailServerSyncEnabled]);

  /** Debounced persist of user edits only (never flush on every keystroke via effect cleanup). */
  React.useEffect(() => {
    if (!emailServerSyncEnabled || !emailServerHydrated) return;
    if (!persistDirtyRef.current) return;
    if (persistBaselineRef.current !== null && persistKey === persistBaselineRef.current) return;

    const timer = window.setTimeout(() => {
      void persistMailboxesRemote(false);
    }, 600);

    return () => {
      window.clearTimeout(timer);
    };
  }, [persistKey, emailServerHydrated, emailServerSyncEnabled, persistMailboxesRemote]);

  /** Flush dirty edits on leave / hard refresh so a pending debounce is not lost. */
  React.useEffect(() => {
    if (!emailServerSyncEnabled || !emailServerHydrated) return;
    const flushIfDirty = () => {
      if (!persistDirtyRef.current) return;
      void persistMailboxesRemote(false);
    };
    window.addEventListener("pagehide", flushIfDirty);
    return () => {
      window.removeEventListener("pagehide", flushIfDirty);
      flushIfDirty();
    };
  }, [emailServerHydrated, emailServerSyncEnabled, persistMailboxesRemote]);

  /**
   * If local signature is empty but the server still has one (e.g. after a prior wipe race),
   * pull it back into the store for editing. Does not overwrite non-empty local edits.
   */
  React.useEffect(() => {
    if (isDemo || !emailServerHydrated || !emailServerSyncEnabled) return;
    let cancelled = false;
    void fetch("/api/email/mailboxes", { credentials: "same-origin", cache: "no-store" })
      .then(async (res) => {
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as {
          mailboxes?: EmailMailboxSettings[];
          sendUsageByMailboxId?: Record<string, { used: number; limit: number | null }>;
        };
        if (cancelled) return;
        if (data.sendUsageByMailboxId) {
          setSendUsageByMailboxId(data.sendUsageByMailboxId);
        }
        if (!Array.isArray(data.mailboxes)) return;
        const serverById = new Map(
          data.mailboxes.map((m) => [m.id, typeof m.signature === "string" ? m.signature : ""]),
        );
        const local = useEmailAccountStore.getState().mailboxes;
        let restored = false;
        for (const mb of local) {
          if (isAssignedMailbox(mb, currentUserId)) continue;
          const serverSig = serverById.get(mb.id);
          if (serverSig == null) continue;
          const localSig = typeof mb.signature === "string" ? mb.signature : "";
          if (!localSig.trim() && serverSig.trim()) {
            updateMailbox(mb.id, { signature: serverSig });
            restored = true;
          }
        }
        // Restoring from server is not a user edit — refresh baseline after store updates.
        if (restored) {
          queueMicrotask(() => {
            persistBaselineRef.current = JSON.stringify(
              useEmailAccountStore
                .getState()
                .mailboxes.filter((m) => !isAssignedMailbox(m, currentUserId)),
            );
            persistDirtyRef.current = false;
          });
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [isDemo, emailServerHydrated, emailServerSyncEnabled, currentUserId, updateMailbox]);

  async function testConnectionsFor(mb: EmailMailboxSettings) {
    const prepared =
      mb.connectionType === "google_workspace"
        ? { ...mb, ...applyGoogleWorkspacePreset(mb) }
        : mb.connectionType === "microsoft_outlook"
          ? { ...mb, ...applyMicrosoftOutlookPreset(mb) }
          : mb;
    const smtpHost = normalizeMailHost(prepared.smtp.host);
    const smtpUser = prepared.smtp.user.trim() || prepared.emailAddress.trim();
    if (!smtpHost) {
      toast.error(
        prepared.connectionType === "google_workspace"
          ? "Enter the Google Workspace email address first."
          : "Enter SMTP host first.",
      );
      return;
    }
    if (!smtpUser) {
      toast.error(
        prepared.connectionType === "google_workspace"
          ? "Enter the Google Workspace email address first."
          : "Enter SMTP username first.",
      );
      return;
    }

    const imapHost = normalizeMailHost(prepared.imap.host);
    const imapUser = prepared.imap.user.trim() || smtpUser;
    const testImap = Boolean(imapHost);
    if (testImap && !imapUser) {
      toast.error("Enter IMAP username first (or clear IMAP host to test SMTP only).");
      return;
    }

    setTestingMailboxId(mb.id);
    try {
      const smtpRes = await fetch("/api/email/smtp-verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mailboxId: mb.id,
          host: smtpHost,
          port: prepared.smtp.port,
          secure: prepared.smtp.secure,
          user: smtpUser,
          pass: prepared.smtp.password,
        }),
      });
      const smtpData = (await smtpRes.json()) as { ok?: boolean; error?: string };

      let imapData: { ok?: boolean; error?: string } | null = null;
      if (testImap) {
        const imapRes = await fetch("/api/email/imap-verify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            mailboxId: mb.id,
            host: imapHost,
            port: prepared.imap.port,
            secure: prepared.imap.secure,
            user: imapUser,
            pass: prepared.imap.password || prepared.smtp.password,
          }),
        });
        imapData = (await imapRes.json()) as { ok?: boolean; error?: string };
      }

      const smtpOk = Boolean(smtpData.ok);
      const imapOk = !testImap || Boolean(imapData?.ok);

      if (smtpOk && imapOk) {
        toast.success(
          testImap ? "SMTP and IMAP settings look correct." : "SMTP settings look correct.",
        );
      } else {
        const parts: string[] = [];
        if (!smtpOk) parts.push(`SMTP: ${smtpData.error ?? "failed"}`);
        if (testImap && imapData && !imapData.ok) {
          parts.push(`IMAP: ${imapData.error ?? "failed"}`);
        }
        toast.error("Connection check failed", {
          description: parts.join("\n\n"),
        });
      }
    } catch {
      toast.error("Could not reach the server");
    } finally {
      setTestingMailboxId(null);
    }
  }

  function setConnectionType(mb: EmailMailboxSettings, type: MailboxConnectionType) {
    if (type === "google_workspace") {
      const next = withGoogleWorkspaceConnection({
        ...mb,
        connectionType: "google_workspace",
        dailySendLimit:
          mb.dailySendLimit == null ? GOOGLE_WORKSPACE_DEFAULT_DAILY_SEND_LIMIT : mb.dailySendLimit,
      });
      updateMailbox(mb.id, next);
      toast.message("Google Workspace preset applied", {
        description: "SMTP/IMAP hosts are filled. Sign in with Google to connect.",
      });
      return;
    }
    if (type === "microsoft_outlook") {
      const next = withMicrosoftOutlookConnection({
        ...mb,
        connectionType: "microsoft_outlook",
        dailySendLimit:
          mb.dailySendLimit == null ? MICROSOFT_OUTLOOK_DEFAULT_DAILY_SEND_LIMIT : mb.dailySendLimit,
      });
      updateMailbox(mb.id, next);
      toast.message("Microsoft / Outlook preset applied", {
        description: "SMTP/IMAP hosts are prefilled. Enter your email, username, and password.",
      });
      return;
    }
    updateMailbox(mb.id, { connectionType: "custom" });
  }

  return (
    <div className="max-w-2xl space-y-4">
      <Card className="border-warning/30 bg-warning/5">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <ShieldAlert className="h-4 w-4 text-warning" />
            Security note
          </CardTitle>
          <CardDescription className="text-xs">
            Mailbox usernames/passwords are saved on the server (encrypted at rest with hash fingerprints), not in
            browser local storage.
          </CardDescription>
        </CardHeader>
      </Card>

      <Card>
        <CardContent className="px-2 pt-4 pb-2">
          <Accordion defaultValue={[]} className="w-full">
            <AccordionItem value="blocked-domains" className="border-b-0">
              <AccordionHeader>
                <AccordionTrigger className="px-2 py-3 hover:no-underline">
                  <div className="flex min-w-0 flex-1 items-center gap-2 text-left">
                    <Ban className="h-4 w-4 shrink-0" />
                    <span className="text-sm font-medium">Blocked sender domains</span>
                    {sortedBlockedDomains.length > 0 ? (
                      <Badge variant="secondary" className="shrink-0 text-[10px] tabular-nums">
                        {sortedBlockedDomains.length}
                      </Badge>
                    ) : null}
                  </div>
                </AccordionTrigger>
              </AccordionHeader>
              <AccordionContent className="px-2 pb-3 pt-0">
                <p className="text-xs text-muted-foreground mb-3">
                  Mail from these domains is moved to Trash automatically when your inbox syncs. Unblock a domain to allow
                  new messages in your inbox again (existing Trash items stay until you delete them). You can also block a
                  domain from the{" "}
                  <Link href="/inbox" className="text-primary underline-offset-2 hover:underline">
                    Inbox
                  </Link>{" "}
                  reading toolbar.
                </p>
                {sortedBlockedDomains.length === 0 ? (
                  <p className="text-xs text-muted-foreground rounded-md border border-dashed px-3 py-4">
                    No blocked domains. Open a message in Inbox and use{" "}
                    <span className="font-medium text-foreground">Block domain</span> to add one.
                  </p>
                ) : (
                  <ul className="divide-y rounded-lg border max-h-64 overflow-y-auto">
                    {sortedBlockedDomains.map((domain) => (
                      <li
                        key={domain}
                        className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5 text-sm"
                      >
                        <span className="font-mono text-xs tabular-nums">{domain}</span>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-7 text-xs"
                          onClick={() => {
                            removeBlockedSenderDomain(domain);
                            toast.success(`Unblocked ${domain}`, {
                              description: "New mail from this domain will appear in your inbox again.",
                            });
                          }}
                        >
                          Unblock
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="px-2 pt-4 pb-2">
          <Accordion defaultValue={[]} className="w-full">
            <AccordionItem value="email-footer" className="border-b-0">
              <AccordionHeader>
                <AccordionTrigger className="px-2 py-3 hover:no-underline">
                  <div className="flex min-w-0 flex-1 items-center gap-2 text-left">
                    <FileText className="h-4 w-4 shrink-0" />
                    <span className="text-sm font-medium">Email footer</span>
                    {globalEmailFooter.trim() ? (
                      <Badge variant="secondary" className="shrink-0 text-[10px]">
                        Set
                      </Badge>
                    ) : null}
                  </div>
                </AccordionTrigger>
              </AccordionHeader>
              <AccordionContent className="px-2 pb-3 pt-0">
                <p className="text-xs text-muted-foreground mb-3">
                  Applies to all mailboxes. When you schedule followup or sequence emails, this footer is
                  included by default (after the mailbox signature). You can uncheck it per send.
                </p>
                <div className="space-y-2">
                  <Label htmlFor="global-email-footer" className="text-xs">
                    Footer text
                  </Label>
                  <Textarea
                    id="global-email-footer"
                    rows={4}
                    value={footerDraft}
                    onChange={(e) => setFooterDraft(e.target.value)}
                    placeholder={`Not relevant? Reply “unsubscribe,” and we will not contact you again.`}
                    className="text-xs font-mono"
                  />
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-[11px] text-muted-foreground">
                      Plain text only. Leave empty to skip the footer option entirely.
                    </p>
                    <div className="flex items-center gap-2">
                      {footerDirty ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-8 text-xs"
                          onClick={() => setFooterDraft(globalEmailFooter)}
                        >
                          Discard
                        </Button>
                      ) : null}
                      <Button
                        type="button"
                        size="sm"
                        className="h-8 gap-1.5"
                        disabled={!footerDirty || footerSaving}
                        onClick={saveGlobalFooter}
                      >
                        {footerSaving ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Save className="h-3.5 w-3.5" />
                        )}
                        Save footer
                      </Button>
                    </div>
                  </div>
                </div>
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3 space-y-0 pb-4">
          <div className="min-w-0 space-y-1.5">
            <CardTitle className="text-sm flex items-center gap-2">
              <Mail className="h-4 w-4 shrink-0" />
              Unified inbox (SMTP / IMAP)
            </CardTitle>
            <CardDescription className="text-xs">
              Add Google Workspace boxes (email + preferred password) or custom SMTP/IMAP. Assign mailboxes to
              teammates and set a daily send limit. Connected mail shows on the{" "}
              <Link href="/inbox" className="text-primary underline-offset-2 hover:underline">
                Inbox
              </Link>{" "}
              → Email tab.
            </CardDescription>
          </div>
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
            <Button
              type="button"
              variant="default"
              size="sm"
              className="gap-1.5"
              disabled={savingRemote || (!isDemo && !emailServerHydrated)}
              onClick={() => void persistMailboxesRemote(true)}
            >
              {savingRemote ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Save className="h-3.5 w-3.5" />
              )}
              Save settings
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="gap-1.5"
              disabled={!isDemo && !emailServerHydrated}
              onClick={() => {
                const id = addMailbox();
                setActiveMailbox(id);
                setOpenValues([id]);
                toast.success("Mailbox added");
              }}
            >
              <Plus className="h-3.5 w-3.5" /> Add mailbox
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {!isDemo && !emailServerHydrated ? (
            <div
              className="flex items-center justify-center gap-2 rounded-lg border px-4 py-10 text-sm text-muted-foreground"
              role="status"
              aria-live="polite"
            >
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading connected mailboxes…
            </div>
          ) : (
          <>
          <div
            className="grid grid-cols-2 gap-2 sm:grid-cols-3"
            aria-label="Mailbox overview stats"
          >
            {(
              [
                {
                  label: "Total",
                  value: mailboxOverviewStats.total,
                  hint: "Owned mailboxes",
                  tone: "default" as const,
                },
                {
                  label: "Connected",
                  value: mailboxOverviewStats.connected,
                  hint: "OAuth / SMTP ready",
                  tone:
                    mailboxOverviewStats.connected === mailboxOverviewStats.total &&
                    mailboxOverviewStats.total > 0
                      ? ("ok" as const)
                      : mailboxOverviewStats.connected < mailboxOverviewStats.total
                        ? ("warn" as const)
                        : ("default" as const),
                },
                {
                  label: "Enabled",
                  value: mailboxOverviewStats.enabled,
                  hint: "Active in Nova",
                  tone: "default" as const,
                },
                {
                  label: "Signatures",
                  value: mailboxOverviewStats.withSignature,
                  hint: "Have a signature",
                  tone:
                    mailboxOverviewStats.withSignature < mailboxOverviewStats.total
                      ? ("warn" as const)
                      : ("ok" as const),
                },
                {
                  label: "Assigned",
                  value: mailboxOverviewStats.withAssignees,
                  hint: "Shared with teammates",
                  tone: "default" as const,
                },
                {
                  label: "Needs fix",
                  value: mailboxOverviewStats.needsAttention,
                  hint: "Missing connection or signature",
                  tone:
                    mailboxOverviewStats.needsAttention > 0
                      ? ("warn" as const)
                      : ("ok" as const),
                },
              ] as const
            ).map((stat) => (
              <div
                key={stat.label}
                className={cn(
                  "rounded-lg border px-2.5 py-2",
                  stat.tone === "ok" && "border-success/25 bg-success/5",
                  stat.tone === "warn" && "border-warning/25 bg-warning/5",
                  stat.tone === "default" && "bg-muted/20",
                )}
                title={stat.hint}
              >
                <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  {stat.label}
                </p>
                <p
                  className={cn(
                    "mt-0.5 text-lg font-semibold tabular-nums leading-none",
                    stat.tone === "ok" && "text-success",
                    stat.tone === "warn" && "text-warning",
                    stat.tone === "default" && "text-foreground",
                  )}
                >
                  {stat.value}
                  {stat.label !== "Total" &&
                  stat.label !== "Needs fix" &&
                  mailboxOverviewStats.total > 0 ? (
                    <span className="ml-1 text-xs font-normal text-muted-foreground">
                      / {mailboxOverviewStats.total}
                    </span>
                  ) : null}
                </p>
              </div>
            ))}
          </div>
          <Accordion
            multiple
            keepMounted
            value={openValues}
            onValueChange={(next, _details) => {
              setOpenValues(next);
              const lastOpened = next[next.length - 1];
              if (lastOpened) setActiveMailbox(lastOpened);
            }}
            className="rounded-lg border px-2"
          >
            {ownedMailboxes.map((mb) => (
              <AccordionItem key={mb.id} value={mb.id} className="border-b-0 not-last:border-b">
                <AccordionHeader>
                  <AccordionTrigger className="py-3 hover:no-underline">
                    <div className="flex min-w-0 flex-1 items-center gap-3">
                      <div className="flex min-w-0 flex-1 flex-col items-start gap-0.5 text-left sm:flex-row sm:items-center sm:gap-3">
                        <span className="truncate font-medium">{mb.label?.trim() || "Mailbox"}</span>
                        {mb.enabled ? (
                          <Badge
                            variant="outline"
                            className="shrink-0 border-success/30 bg-success/10 text-[10px] text-success"
                          >
                            Enabled
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="shrink-0 text-[10px] text-muted-foreground">
                            Off
                          </Badge>
                        )}
                        {mb.emailAddress?.trim() &&
                        mb.emailAddress.trim().toLowerCase() !== (mb.label?.trim() || "").toLowerCase() ? (
                          <span className="truncate text-xs font-normal text-muted-foreground">
                            {mb.emailAddress.trim()}
                          </span>
                        ) : null}
                      </div>
                      <MailboxQuickStatus
                        mailbox={mb}
                        sendUsage={sendUsageByMailboxId[mb.id]}
                      />
                    </div>
                  </AccordionTrigger>
                </AccordionHeader>
                <AccordionContent className="pb-4 pt-0">
                  <div className="space-y-6 border-t pt-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        className="gap-1.5"
                        disabled={testingMailboxId != null}
                        onClick={() => void testConnectionsFor(mb)}
                      >
                        {testingMailboxId === mb.id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <PlugZap className="h-3.5 w-3.5" />
                        )}
                        Test connection
                      </Button>
                      {ownedMailboxes.length > 1 && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="text-destructive gap-1.5"
                          onClick={() => removeMailbox(mb.id)}
                        >
                          <Trash2 className="h-3.5 w-3.5" /> Remove mailbox
                        </Button>
                      )}
                    </div>

                    <div className="flex items-center justify-between gap-4 rounded-lg border p-3">
                      <div>
                        <div className="text-sm font-medium">Enable mail in Nova</div>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          Turn on when SMTP is ready. The Email view stays available either way.
                        </p>
                      </div>
                      <Switch
                        checked={mb.enabled}
                        onCheckedChange={(v) => {
                          updateMailbox(mb.id, { enabled: !!v });
                          toast.success(v ? "Mail enabled" : "Mail disabled");
                        }}
                      />
                    </div>

                    <div className="space-y-2">
                      <Label className="text-xs">Connection type</Label>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          type="button"
                          size="sm"
                          variant={mb.connectionType === "google_workspace" ? "default" : "outline"}
                          className={cn("h-8")}
                          onClick={() => setConnectionType(mb, "google_workspace")}
                        >
                          Google Workspace
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant={mb.connectionType === "microsoft_outlook" ? "default" : "outline"}
                          className={cn("h-8")}
                          onClick={() => setConnectionType(mb, "microsoft_outlook")}
                        >
                          Microsoft / Outlook
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant={mb.connectionType === "custom" ? "default" : "outline"}
                          className={cn("h-8")}
                          onClick={() => setConnectionType(mb, "custom")}
                        >
                          Custom SMTP
                        </Button>
                      </div>
                      <p className="text-[11px] text-muted-foreground">
                        {mb.connectionType === "google_workspace"
                          ? "For Inboxlogy / warmed Google Workspace: Sign in with Google (OAuth). Preferred passwords no longer work for SMTP/IMAP."
                          : mb.connectionType === "microsoft_outlook"
                            ? "Outlook / Microsoft 365 SMTP and IMAP hosts are prefilled. Use the same fields as Custom SMTP for credentials."
                            : "Full SMTP and IMAP fields for other custom mail hosts."}
                      </p>
                    </div>

                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="space-y-1.5 sm:col-span-2">
                        <Label className="text-xs">Mailbox label</Label>
                        <Input
                          className="h-9"
                          value={mb.label}
                          onChange={(e) => updateMailbox(mb.id, { label: e.target.value })}
                          placeholder="Founder inbox"
                        />
                      </div>
                      <div className="space-y-1.5 sm:col-span-1">
                        <Label className="text-xs">Display name</Label>
                        <Input
                          className="h-9"
                          value={mb.displayName}
                          onChange={(e) => updateMailbox(mb.id, { displayName: e.target.value })}
                          placeholder="James Mitchell"
                        />
                      </div>
                      <div className="space-y-1.5 sm:col-span-1">
                        <Label className="text-xs">Email address (From)</Label>
                        <Input
                          className="h-9"
                          type="email"
                          value={mb.emailAddress}
                          onChange={(e) => {
                            const emailAddress = e.target.value;
                            if (mb.connectionType === "google_workspace") {
                              updateMailbox(mb.id, {
                                emailAddress,
                                smtp: { ...mb.smtp, user: emailAddress.trim() },
                                imap: { ...mb.imap, user: emailAddress.trim() },
                              });
                            } else {
                              updateMailbox(mb.id, { emailAddress });
                            }
                          }}
                          onBlur={(e) => {
                            const emailAddress = e.target.value.trim();
                            if (!emailAddress) return;
                            const owned = useEmailAccountStore
                              .getState()
                              .mailboxes.filter((m) => !isAssignedMailbox(m, currentUserId));
                            const dup = findDuplicateMailboxByEmail(owned, emailAddress, mb.id);
                            if (!dup) return;
                            toast.error("This email is already added", {
                              description: `${emailAddress} is already used by “${dup.label?.trim() || dup.emailAddress.trim() || "another mailbox"}”.`,
                            });
                          }}
                          placeholder="you@company.com"
                          aria-invalid={
                            Boolean(
                              findDuplicateMailboxByEmail(
                                ownedMailboxes,
                                mb.emailAddress,
                                mb.id,
                              ),
                            ) || undefined
                          }
                        />
                        {findDuplicateMailboxByEmail(ownedMailboxes, mb.emailAddress, mb.id) ? (
                          <p className="text-[11px] text-destructive">
                            This email is already added on another mailbox.
                          </p>
                        ) : null}
                      </div>
                      <div className="space-y-1.5 sm:col-span-2">
                        <Label className="text-xs">Reply-To (optional)</Label>
                        <Input
                          className="h-9"
                          type="email"
                          value={mb.replyTo}
                          onChange={(e) => updateMailbox(mb.id, { replyTo: e.target.value })}
                          placeholder="support@company.com"
                        />
                      </div>
                      <div className="space-y-1.5 sm:col-span-1">
                        <Label className="text-xs">Daily send limit</Label>
                        <Input
                          className="h-9"
                          type="number"
                          min={1}
                          placeholder="Unlimited"
                          value={mb.dailySendLimit ?? ""}
                          onChange={(e) => {
                            const raw = e.target.value.trim();
                            if (!raw) {
                              updateMailbox(mb.id, { dailySendLimit: null });
                              return;
                            }
                            const n = Math.floor(Number(raw));
                            updateMailbox(mb.id, {
                              dailySendLimit: Number.isFinite(n) && n > 0 ? n : null,
                            });
                          }}
                        />
                        <p className="text-[11px] text-muted-foreground">
                          Empty = unlimited. Counts successful sends per UTC day.
                          {sendUsageByMailboxId[mb.id]
                            ? ` Used today: ${sendUsageByMailboxId[mb.id]!.used}${
                                mb.dailySendLimit != null ? ` / ${mb.dailySendLimit}` : ""
                              }.`
                            : null}
                        </p>
                      </div>
                      <div className="space-y-1.5 sm:col-span-1">
                        <Label className="text-xs">Send gap (seconds)</Label>
                        <Input
                          className="h-9"
                          type="number"
                          min={0}
                          max={120}
                          placeholder="15"
                          value={mb.sendGapSeconds ?? ""}
                          onChange={(e) => {
                            const raw = e.target.value.trim();
                            if (!raw) {
                              updateMailbox(mb.id, { sendGapSeconds: null });
                              return;
                            }
                            const n = Math.floor(Number(raw));
                            updateMailbox(mb.id, {
                              sendGapSeconds:
                                Number.isFinite(n) && n >= 0 ? Math.min(120, n) : null,
                            });
                          }}
                        />
                        <p className="text-[11px] text-muted-foreground">
                          Minimum delay between sends from this mailbox (0–120). Empty = 15s
                          default. Spaces sequence bursts for deliverability.
                        </p>
                      </div>
                    </div>

                    <Separator />

                    {mb.connectionType === "google_workspace" ? (
                      <div className="space-y-3">
                        <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                          Google Workspace authentication
                        </h4>
                        <div className="rounded-lg border p-3 space-y-3">
                          <p className="text-xs text-muted-foreground">
                            Google no longer accepts Inboxlogy preferred passwords (or normal Workspace
                            passwords) for SMTP/IMAP. Sign in with Google once — use the inbox email and
                            preferred password on Google&apos;s login screen — then Nova uses OAuth tokens.
                          </p>
                          {mb.googleAuthConnected ? (
                            <div className="flex flex-wrap items-center gap-2.5 rounded-md border border-success/25 bg-success/10 px-3 py-2.5">
                              <CheckCircle2
                                className="h-4 w-4 shrink-0 text-success"
                                aria-hidden
                              />
                              <div className="min-w-0 flex-1">
                                <p className="text-xs font-medium text-success">Connected</p>
                                <p className="truncate text-sm text-foreground">
                                  {mb.emailAddress.trim() || "Mailbox linked"}
                                </p>
                              </div>
                              <Badge
                                variant="outline"
                                className="border-success/30 bg-success/15 text-[10px] text-success"
                              >
                                Google
                              </Badge>
                            </div>
                          ) : (
                            <div className="rounded-md border border-warning/25 bg-warning/10 px-3 py-2.5">
                              <p className="text-xs font-medium text-warning">
                                Not connected with Google yet
                              </p>
                              <p className="mt-0.5 text-[11px] text-muted-foreground">
                                Sign in below to authorize SMTP/IMAP via OAuth.
                              </p>
                            </div>
                          )}
                          <Button
                            type="button"
                            size="sm"
                            variant={mb.googleAuthConnected ? "outline" : "default"}
                            className="gap-1.5"
                            disabled={isDemo}
                            onClick={() => {
                              if (isDemo) {
                                toast.message("Google sign-in is not available in demo mode.");
                                return;
                              }
                              window.location.href = `/api/email/oauth/google?mailboxId=${encodeURIComponent(mb.id)}`;
                            }}
                          >
                            {mb.googleAuthConnected ? "Reconnect Google" : "Sign in with Google"}
                          </Button>
                          <p className="text-[11px] text-muted-foreground">
                            Requires GOOGLE_CALENDAR_CLIENT_ID / SECRET (or GOOGLE_MAIL_*) with redirect URI{" "}
                            <code className="text-foreground">/api/email/oauth/google</code> and scope{" "}
                            <code className="text-foreground">https://mail.google.com/</code>.
                          </p>
                        </div>
                        <div className="space-y-1.5 max-w-[120px]">
                          <Label className="text-xs">Sync interval (minutes)</Label>
                          <Input
                            className="h-9"
                            type="number"
                            min={5}
                            value={mb.syncIntervalMinutes}
                            onChange={(e) =>
                              updateMailbox(mb.id, {
                                syncIntervalMinutes: Math.max(5, Number(e.target.value) || 15),
                              })
                            }
                          />
                        </div>
                      </div>
                    ) : (
                      <>
                    <div>
                      <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">
                        Outgoing (SMTP)
                      </h4>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <div className="space-y-1.5 sm:col-span-2">
                          <Label className="text-xs">SMTP host</Label>
                          <Input
                            className="h-9"
                            value={mb.smtp.host}
                            onChange={(e) => setSmtp(mb.id, { host: e.target.value })}
                            onBlur={() => {
                              const n = normalizeMailHost(mb.smtp.host);
                              if (n && n !== mb.smtp.host) setSmtp(mb.id, { host: n });
                            }}
                            placeholder="amsr200.websitehostserver.net"
                          />
                          <p className="text-[11px] text-muted-foreground">
                            Hostname only, do not paste a web URL (no{" "}
                            <code className="text-foreground">http://</code> or path).
                          </p>
                        </div>
                        <div className="space-y-1.5">
                          <Label className="text-xs">Port</Label>
                          <Input
                            className="h-9"
                            type="number"
                            value={mb.smtp.port || ""}
                            onChange={(e) => setSmtp(mb.id, { port: Number(e.target.value) || 0 })}
                          />
                        </div>
                        <div className="flex items-end pb-1 gap-2">
                          <Switch
                            id={`smtp-secure-${mb.id}`}
                            checked={mb.smtp.secure}
                            onCheckedChange={(v) => setSmtp(mb.id, { secure: !!v })}
                          />
                          <Label htmlFor={`smtp-secure-${mb.id}`} className="text-xs cursor-pointer">
                            TLS / SSL (implicit)
                          </Label>
                        </div>
                        <div className="space-y-1.5">
                          <Label className="text-xs">Username</Label>
                          <Input
                            className="h-9"
                            value={mb.smtp.user}
                            onChange={(e) => setSmtp(mb.id, { user: e.target.value })}
                          />
                        </div>
                        <div className="space-y-1.5">
                          <Label className="text-xs">Password / app password</Label>
                          <div className="relative">
                            <Input
                              className="h-9 pr-10"
                              type={passwordFieldVisible[`${mb.id}:smtp`] ? "text" : "password"}
                              autoComplete="new-password"
                              value={mb.smtp.password}
                              onChange={(e) => setSmtp(mb.id, { password: e.target.value })}
                            />
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-sm"
                              className="absolute right-0.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                              aria-label={
                                passwordFieldVisible[`${mb.id}:smtp`]
                                  ? "Hide SMTP password"
                                  : "Show SMTP password"
                              }
                              aria-pressed={passwordFieldVisible[`${mb.id}:smtp`] ?? false}
                              onClick={() => {
                                const k = `${mb.id}:smtp`;
                                setPasswordFieldVisible((prev) => ({ ...prev, [k]: !prev[k] }));
                              }}
                            >
                              {passwordFieldVisible[`${mb.id}:smtp`] ? (
                                <EyeOff className="h-4 w-4" />
                              ) : (
                                <Eye className="h-4 w-4" />
                              )}
                            </Button>
                          </div>
                        </div>
                      </div>
                      <p className="mt-2 text-[11px] text-muted-foreground">
                        Use <span className="font-medium text-foreground">Test connection</span> above to verify SMTP
                        (and IMAP when host and username are filled).{" "}
                        {isEmailAccountConfigured(mb)
                          ? "Ready to send from Inbox → Email; with IMAP filled, Refresh loads incoming mail."
                          : "Fill host and From address to send."}
                      </p>
                    </div>

                    <Separator />

                    <div>
                      <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">
                        Incoming (IMAP)
                      </h4>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <div className="space-y-1.5 sm:col-span-2">
                          <Label className="text-xs">IMAP host</Label>
                          <Input
                            className="h-9"
                            value={mb.imap.host}
                            onChange={(e) => setImap(mb.id, { host: e.target.value })}
                            onBlur={() => {
                              const n = normalizeMailHost(mb.imap.host);
                              if (n && n !== mb.imap.host) setImap(mb.id, { host: n });
                            }}
                            placeholder="amsr200.websitehostserver.net"
                          />
                        </div>
                        <div className="space-y-1.5">
                          <Label className="text-xs">Port</Label>
                          <Input
                            className="h-9"
                            type="number"
                            value={mb.imap.port || ""}
                            onChange={(e) => setImap(mb.id, { port: Number(e.target.value) || 0 })}
                          />
                        </div>
                        <div className="flex items-end pb-1 gap-2">
                          <Switch
                            id={`imap-secure-${mb.id}`}
                            checked={mb.imap.secure}
                            onCheckedChange={(v) => setImap(mb.id, { secure: !!v })}
                          />
                          <Label htmlFor={`imap-secure-${mb.id}`} className="text-xs cursor-pointer">
                            TLS (typical for 993)
                          </Label>
                        </div>
                        <div className="space-y-1.5">
                          <Label className="text-xs">Username</Label>
                          <Input
                            className="h-9"
                            value={mb.imap.user}
                            onChange={(e) => setImap(mb.id, { user: e.target.value })}
                          />
                        </div>
                        <div className="space-y-1.5">
                          <Label className="text-xs">Password</Label>
                          <div className="relative">
                            <Input
                              className="h-9 pr-10"
                              type={passwordFieldVisible[`${mb.id}:imap`] ? "text" : "password"}
                              autoComplete="new-password"
                              value={mb.imap.password}
                              onChange={(e) => setImap(mb.id, { password: e.target.value })}
                            />
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-sm"
                              className="absolute right-0.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                              aria-label={
                                passwordFieldVisible[`${mb.id}:imap`]
                                  ? "Hide IMAP password"
                                  : "Show IMAP password"
                              }
                              aria-pressed={passwordFieldVisible[`${mb.id}:imap`] ?? false}
                              onClick={() => {
                                const k = `${mb.id}:imap`;
                                setPasswordFieldVisible((prev) => ({ ...prev, [k]: !prev[k] }));
                              }}
                            >
                              {passwordFieldVisible[`${mb.id}:imap`] ? (
                                <EyeOff className="h-4 w-4" />
                              ) : (
                                <Eye className="h-4 w-4" />
                              )}
                            </Button>
                          </div>
                        </div>
                        <div className="space-y-1.5 sm:col-span-2">
                          <Label className="text-xs">Sync interval (minutes)</Label>
                          <Input
                            className="h-9 max-w-[120px]"
                            type="number"
                            min={5}
                            value={mb.syncIntervalMinutes}
                            onChange={(e) =>
                              updateMailbox(mb.id, {
                                syncIntervalMinutes: Math.max(5, Number(e.target.value) || 15),
                              })
                            }
                          />
                          <p className="text-[11px] text-muted-foreground">
                            Inbox syncs automatically in the background on this interval while you use the CRM (any
                            screen). Use Refresh on Inbox → Email for an immediate pull.
                          </p>
                        </div>
                      </div>
                    </div>
                      </>
                    )}

                    <Separator />

                    <div className="space-y-3">
                      <div>
                        <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                          Assign to users
                        </h4>
                        <p className="mt-1 text-[11px] text-muted-foreground">
                          Teammates can view and send from this mailbox in Inbox. They cannot edit credentials.
                        </p>
                      </div>
                      <div className="flex flex-wrap items-end gap-2">
                        <div className="min-w-[12rem] flex-1 space-y-1">
                          <Label className="text-xs">Add teammate</Label>
                          <Select
                            value={assignPickByMailbox[mb.id] || undefined}
                            onValueChange={(v) =>
                              setAssignPickByMailbox((prev) => ({ ...prev, [mb.id]: v ?? "" }))
                            }
                            disabled={isDemo}
                          >
                            <SelectTrigger className="h-9 w-full text-xs">
                              <SelectValue placeholder="Select a person">
                                {assignTeammateTriggerLabel(
                                  assignPickByMailbox[mb.id],
                                  activeAssignableOptions,
                                  assignedInboxCountByUserId,
                                  (id) =>
                                    granteeLabels.get(id) ?? getOwnerDisplayName(id) ?? undefined,
                                )}
                              </SelectValue>
                            </SelectTrigger>
                            <SelectContent>
                              {activeAssignableOptions
                                .filter((o) => !(mb.assignedUserIds ?? []).includes(o.id))
                                .map((o) => {
                                  const inboxCount = assignedInboxCountByUserId.get(o.id) ?? 0;
                                  return (
                                    <SelectItem key={o.id} value={o.id}>
                                      {o.label} ({inboxCount})
                                    </SelectItem>
                                  );
                                })}
                            </SelectContent>
                          </Select>
                        </div>
                        <Button
                          type="button"
                          size="sm"
                          className="h-9"
                          disabled={isDemo || !assignPickByMailbox[mb.id]}
                          onClick={() => {
                            const uid = (assignPickByMailbox[mb.id] ?? "").trim();
                            if (!uid) return;
                            const next = [...new Set([...(mb.assignedUserIds ?? []), uid])];
                            updateMailbox(mb.id, { assignedUserIds: next });
                            setAssignPickByMailbox((prev) => ({ ...prev, [mb.id]: "" }));
                            toast.success("User assigned to mailbox");
                          }}
                        >
                          <Plus className="h-3.5 w-3.5" />
                          Assign
                        </Button>
                      </div>
                      {(mb.assignedUserIds ?? []).length === 0 ? (
                        <p className="text-xs text-muted-foreground rounded-md border border-dashed px-3 py-4">
                          No teammates assigned to this mailbox yet.
                        </p>
                      ) : (
                        <ul className="divide-y rounded-lg border max-h-48 overflow-y-auto">
                          {(mb.assignedUserIds ?? []).map((uid) => (
                            <li
                              key={uid}
                              className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5 text-sm"
                            >
                              <span className="truncate text-xs">
                                {granteeLabels.get(uid) ?? getOwnerDisplayName(uid) ?? uid}
                              </span>
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="h-7 text-xs"
                                disabled={isDemo}
                                onClick={() => {
                                  updateMailbox(mb.id, {
                                    assignedUserIds: (mb.assignedUserIds ?? []).filter(
                                      (id) => id !== uid,
                                    ),
                                  });
                                }}
                              >
                                Remove
                              </Button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>

                    <Separator />

                    <div className="space-y-2">
                      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
                        <div className="flex items-center gap-2">
                          <Switch
                            id={`archive-send-${mb.id}`}
                            checked={mb.archiveOnSend}
                            onCheckedChange={(v) => updateMailbox(mb.id, { archiveOnSend: !!v })}
                          />
                          <Label htmlFor={`archive-send-${mb.id}`} className="text-xs cursor-pointer">
                            Archive on send (future)
                          </Label>
                        </div>
                        <div className="flex items-center gap-2">
                          <Switch
                            id={`read-rcpt-${mb.id}`}
                            checked={mb.readReceipts}
                            onCheckedChange={(v) => updateMailbox(mb.id, { readReceipts: !!v })}
                          />
                          <Label htmlFor={`read-rcpt-${mb.id}`} className="text-xs cursor-pointer">
                            Read receipts (future)
                          </Label>
                        </div>
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-xs" htmlFor={`email-signature-${mb.id}`}>
                          Email signature
                        </Label>
                        <Textarea
                          id={`email-signature-${mb.id}`}
                          rows={4}
                          value={typeof mb.signature === "string" ? mb.signature : ""}
                          onChange={(e) => updateMailbox(mb.id, { signature: e.target.value })}
                          placeholder={"James Mitchell\nDirector, Nova Inc."}
                          className="text-sm resize-y min-h-[88px] font-normal text-foreground"
                        />
                        <p className="text-[10px] text-muted-foreground">
                          Appended automatically when composing in Inbox and when scheduling
                          follow-up / sequence emails from this mailbox.
                        </p>
                      </div>
                    </div>
                  </div>
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
          </>
          )}

          <p className="text-[11px] text-muted-foreground">
            Non-sensitive fields sync to your workspace; credentials are encrypted on the server. Changes also save
            automatically after you stop typing, use <span className="font-medium text-foreground">Save settings</span>{" "}
            to write immediately and confirm the server accepted them.
            {savingRemote ? " Saving to workspace..." : ""} For Google Workspace, use Sign in with Google (OAuth).
            Custom SMTP can still use a provider password or app password when 2FA is on.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
