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
import type { EmailMailboxSettings } from "@/lib/email-account-types";
import { normalizeMailHost } from "@/lib/email/normalize-mail-host";
import { toast } from "sonner";
import { Ban, Eye, EyeOff, Loader2, Mail, PlugZap, ShieldAlert, Plus, Save, Trash2 } from "lucide-react";

export function EmailInboxSettingsCard() {
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
  const sortedBlockedDomains = React.useMemo(
    () => [...blockedSenderDomains].sort((a, b) => a.localeCompare(b)),
    [blockedSenderDomains],
  );
  const [savingRemote, setSavingRemote] = React.useState(false);
  const [testingMailboxId, setTestingMailboxId] = React.useState<string | null>(null);
  const [openValues, setOpenValues] = React.useState<string[]>([]);
  /** `${mailboxId}:smtp` | `${mailboxId}:imap` → password field visible as plain text */
  const [passwordFieldVisible, setPasswordFieldVisible] = React.useState<Record<string, boolean>>({});

  const persistKey = React.useMemo(() => JSON.stringify(mailboxes), [mailboxes]);

  /**
   * Persists all mailboxes to the server.
   * @param manual — when true, shows success/error toasts and surfaces “not ready” as an error instead of no-op.
   */
  const persistMailboxesRemote = React.useCallback(async (manual?: boolean): Promise<boolean> => {
    const s = useEmailAccountStore.getState();
    if (!s.emailServerSyncEnabled || !s.emailServerHydrated) {
      if (manual) {
        toast.error("Could not save email settings", {
          description: !s.emailServerHydrated
            ? "Your mailboxes are still loading. Wait a moment, then try again."
            : "Saving is unavailable—check your connection or sign in again. If this persists, reload the page.",
        });
      }
      return false;
    }
    const all = s.mailboxes;
    setSavingRemote(true);
    try {
      for (const mb of all) {
        const res = await fetch("/api/email/mailboxes", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({ mailbox: mb }),
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
  }, []);

  React.useEffect(() => {
    if (mailboxes.length === 0) {
      setOpenValues([]);
      return;
    }
    setOpenValues((prev) => {
      const kept = prev.filter((id) => mailboxes.some((m) => m.id === id));
      if (kept.length > 0) return kept;
      const preferred = activeMailboxId && mailboxes.some((m) => m.id === activeMailboxId);
      return [preferred ? activeMailboxId! : mailboxes[0]!.id];
    });
  }, [mailboxes, activeMailboxId]);

  /** Debounced persist; flush when the timer is cancelled (refresh / route change) so edits are not lost. */
  React.useEffect(() => {
    if (!emailServerSyncEnabled || !emailServerHydrated) return;

    let timerFired = false;
    const timer = window.setTimeout(() => {
      timerFired = true;
      void persistMailboxesRemote(false);
    }, 600);

    return () => {
      window.clearTimeout(timer);
      if (!timerFired) void persistMailboxesRemote(false);
    };
  }, [persistKey, emailServerHydrated, emailServerSyncEnabled, persistMailboxesRemote]);

  /** Hard refresh / tab close can tear down React before the debounced effect runs; flush once. */
  React.useEffect(() => {
    if (!emailServerSyncEnabled || !emailServerHydrated) return;
    const onPageHide = () => {
      void persistMailboxesRemote(false);
    };
    window.addEventListener("pagehide", onPageHide);
    return () => window.removeEventListener("pagehide", onPageHide);
  }, [emailServerHydrated, emailServerSyncEnabled, persistMailboxesRemote]);

  async function testConnectionsFor(mb: EmailMailboxSettings) {
    const smtpHost = normalizeMailHost(mb.smtp.host);
    const smtpUser = mb.smtp.user.trim();
    if (!smtpHost) {
      toast.error("Enter SMTP host first.");
      return;
    }
    if (!smtpUser) {
      toast.error("Enter SMTP username first.");
      return;
    }

    const imapHost = normalizeMailHost(mb.imap.host);
    const imapUser = mb.imap.user.trim();
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
          port: mb.smtp.port,
          secure: mb.smtp.secure,
          user: smtpUser,
          pass: mb.smtp.password,
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
            port: mb.imap.port,
            secure: mb.imap.secure,
            user: imapUser,
            pass: mb.imap.password,
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
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Ban className="h-4 w-4 shrink-0" />
            Blocked sender domains
          </CardTitle>
          <CardDescription className="text-xs">
            Mail from these domains is moved to Trash automatically when your inbox syncs. Unblock a domain to allow new
            messages in your inbox again (existing Trash items stay until you delete them). You can also block a domain
            from the{" "}
            <Link href="/inbox" className="text-primary underline-offset-2 hover:underline">
              Inbox
            </Link>{" "}
            reading toolbar.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {sortedBlockedDomains.length === 0 ? (
            <p className="text-xs text-muted-foreground rounded-md border border-dashed px-3 py-4">
              No blocked domains. Open a message in Inbox and use{" "}
              <span className="font-medium text-foreground">Block domain</span> to add one.
            </p>
          ) : (
            <ul className="divide-y rounded-lg border">
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
              Add your mailbox like you would in Outlook: use the same address, SMTP to send, and IMAP to load your
              Inbox on the{" "}
              <Link href="/inbox" className="text-primary underline-offset-2 hover:underline">
                Inbox
              </Link>{" "}
              → Email tab. Open each mailbox below to edit. Use Test connection inside a mailbox to verify SMTP/IMAP.
            </CardDescription>
          </div>
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
            <Button
              type="button"
              variant="default"
              size="sm"
              className="gap-1.5"
              disabled={savingRemote}
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
          <Accordion
            multiple
            value={openValues}
            onValueChange={(next, _details) => {
              setOpenValues(next);
              const lastOpened = next[next.length - 1];
              if (lastOpened) setActiveMailbox(lastOpened);
            }}
            className="rounded-lg border px-2"
          >
            {mailboxes.map((mb) => (
              <AccordionItem key={mb.id} value={mb.id} className="border-b-0 not-last:border-b">
                <AccordionHeader>
                  <AccordionTrigger className="py-3 hover:no-underline">
                    <div className="flex min-w-0 flex-1 flex-col items-start gap-0.5 text-left sm:flex-row sm:items-center sm:gap-3">
                      <span className="truncate font-medium">{mb.label?.trim() || "Mailbox"}</span>
                      {mb.enabled ? (
                        <Badge variant="secondary" className="shrink-0 text-[10px]">
                          Enabled
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="shrink-0 text-[10px] text-muted-foreground">
                          Off
                        </Badge>
                      )}
                      {mb.emailAddress?.trim() ? (
                        <span className="truncate text-xs font-normal text-muted-foreground">{mb.emailAddress.trim()}</span>
                      ) : null}
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
                      {mailboxes.length > 1 && (
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
                          onChange={(e) => updateMailbox(mb.id, { emailAddress: e.target.value })}
                          placeholder="you@company.com"
                        />
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
                    </div>

                    <Separator />

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
                            Hostname only — do not paste a web URL (no{" "}
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
                        <Label className="text-xs">Email signature</Label>
                        <Textarea
                          rows={4}
                          value={mb.signature}
                          onChange={(e) => updateMailbox(mb.id, { signature: e.target.value })}
                          placeholder="&#10;James Mitchell&#10;Director, Nova Inc."
                          className="text-sm resize-y min-h-[88px]"
                        />
                      </div>
                    </div>
                  </div>
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>

          <p className="text-[11px] text-muted-foreground">
            Non-sensitive fields sync to your workspace; credentials are encrypted on the server. Changes also save
            automatically after you stop typing—use <span className="font-medium text-foreground">Save settings</span>{" "}
            to write immediately and confirm the server accepted them.
            {savingRemote ? " Saving to workspace..." : ""} Use an app-specific password for Gmail / Microsoft when 2FA
            is on.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
