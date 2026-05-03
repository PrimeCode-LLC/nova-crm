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
import { useEmailAccountStore, isEmailAccountConfigured } from "@/stores/email-account-store";
import { normalizeMailHost } from "@/lib/email/normalize-mail-host";
import { toast } from "sonner";
import { Loader2, Mail, PlugZap, ShieldAlert } from "lucide-react";

export function EmailInboxSettingsCard() {
  const account = useEmailAccountStore((s) => s.account);
  const setAccount = useEmailAccountStore((s) => s.setAccount);
  const setSmtp = useEmailAccountStore((s) => s.setSmtp);
  const setImap = useEmailAccountStore((s) => s.setImap);
  const [testing, setTesting] = React.useState(false);

  async function testConnections() {
    const smtpHost = normalizeMailHost(account.smtp.host);
    const smtpUser = account.smtp.user.trim();
    if (!smtpHost || !smtpUser) {
      toast.error("Enter SMTP host and username first.");
      return;
    }

    const imapHost = normalizeMailHost(account.imap.host);
    const imapUser = account.imap.user.trim();
    const testImap = Boolean(imapHost && imapUser);

    setTesting(true);
    try {
      const smtpRes = await fetch("/api/email/smtp-verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          host: smtpHost,
          port: account.smtp.port,
          secure: account.smtp.secure,
          user: smtpUser,
          pass: account.smtp.password,
        }),
      });
      const smtpData = (await smtpRes.json()) as { ok?: boolean; error?: string };

      let imapData: { ok?: boolean; error?: string } | null = null;
      if (testImap) {
        const imapRes = await fetch("/api/email/imap-verify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            host: imapHost,
            port: account.imap.port,
            secure: account.imap.secure,
            user: imapUser,
            pass: account.imap.password,
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
        toast.error(parts.join(" · "));
      }
    } catch {
      toast.error("Could not reach the server");
    } finally {
      setTesting(false);
    }
  }

  const configured = isEmailAccountConfigured(account);

  return (
    <div className="max-w-2xl space-y-4">
      <Card className="border-warning/30 bg-warning/5">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <ShieldAlert className="h-4 w-4 text-warning" />
            Security note
          </CardTitle>
          <CardDescription className="text-xs">
            Mail passwords are stored in this browser only (localStorage). For production, move credentials to a
            secure server vault and use OAuth where your provider supports it. Never share this device while logged in
            to Nova CRM with mail enabled.
          </CardDescription>
        </CardHeader>
      </Card>

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3 space-y-0 pb-4">
          <div className="min-w-0 space-y-1.5">
            <CardTitle className="text-sm flex items-center gap-2">
              <Mail className="h-4 w-4 shrink-0" />
              Unified inbox (SMTP / IMAP)
            </CardTitle>
            <CardDescription className="text-xs">
              Connect your mailbox so Nova can send email and (soon) sync inbound threads into the Email tab on{" "}
              <Link href="/inbox" className="text-primary underline-offset-2 hover:underline">
                Inbox
              </Link>
              . IMAP fields are saved for the upcoming background sync engine.
            </CardDescription>
          </div>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="shrink-0 gap-1.5"
            disabled={testing}
            onClick={() => void testConnections()}
          >
            {testing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <PlugZap className="h-3.5 w-3.5" />}
            Test connection
          </Button>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex items-center justify-between gap-4 rounded-lg border p-3">
            <div>
              <div className="text-sm font-medium">Enable mail in Nova</div>
              <p className="text-xs text-muted-foreground mt-0.5">
                Turn on when SMTP is ready. The Email view stays available either way.
              </p>
            </div>
            <Switch
              checked={account.enabled}
              onCheckedChange={(v) => {
                setAccount({ enabled: !!v });
                toast.success(v ? "Mail enabled" : "Mail disabled");
              }}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-1">
              <Label className="text-xs">Display name</Label>
              <Input
                className="h-9"
                value={account.displayName}
                onChange={(e) => setAccount({ displayName: e.target.value })}
                placeholder="James Mitchell"
              />
            </div>
            <div className="space-y-1.5 sm:col-span-1">
              <Label className="text-xs">Email address (From)</Label>
              <Input
                className="h-9"
                type="email"
                value={account.emailAddress}
                onChange={(e) => setAccount({ emailAddress: e.target.value })}
                placeholder="you@company.com"
              />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label className="text-xs">Reply-To (optional)</Label>
              <Input
                className="h-9"
                type="email"
                value={account.replyTo}
                onChange={(e) => setAccount({ replyTo: e.target.value })}
                placeholder="support@company.com"
              />
            </div>
          </div>

          <Separator />

          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">Outgoing (SMTP)</h4>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5 sm:col-span-2">
                <Label className="text-xs">SMTP host</Label>
                <Input
                  className="h-9"
                  value={account.smtp.host}
                  onChange={(e) => setSmtp({ host: e.target.value })}
                  onBlur={() => {
                    const n = normalizeMailHost(account.smtp.host);
                    if (n && n !== account.smtp.host) setSmtp({ host: n });
                  }}
                  placeholder="amsr200.websitehostserver.net"
                />
                <p className="text-[11px] text-muted-foreground">
                  Hostname only — do not paste a web URL (no <code className="text-foreground">http://</code> or path).
                </p>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Port</Label>
                <Input
                  className="h-9"
                  type="number"
                  value={account.smtp.port || ""}
                  onChange={(e) => setSmtp({ port: Number(e.target.value) || 0 })}
                />
              </div>
              <div className="flex items-end pb-1 gap-2">
                <Switch
                  id="smtp-secure"
                  checked={account.smtp.secure}
                  onCheckedChange={(v) => setSmtp({ secure: !!v })}
                />
                <Label htmlFor="smtp-secure" className="text-xs cursor-pointer">
                  TLS / SSL (implicit)
                </Label>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Username</Label>
                <Input
                  className="h-9"
                  value={account.smtp.user}
                  onChange={(e) => setSmtp({ user: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Password / app password</Label>
                <Input
                  className="h-9"
                  type="password"
                  autoComplete="new-password"
                  value={account.smtp.password}
                  onChange={(e) => setSmtp({ password: e.target.value })}
                />
              </div>
            </div>
            <p className="mt-2 text-[11px] text-muted-foreground">
              Use <span className="font-medium text-foreground">Test connection</span> above to verify SMTP (and
              IMAP when host and username are filled).{" "}
              {configured ? "Ready to send from Inbox → Email." : "Fill host, user, and From address to send."}
            </p>
          </div>

          <Separator />

          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">
              Incoming (IMAP), reserved for sync
            </h4>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5 sm:col-span-2">
                <Label className="text-xs">IMAP host</Label>
                <Input
                  className="h-9"
                  value={account.imap.host}
                  onChange={(e) => setImap({ host: e.target.value })}
                  onBlur={() => {
                    const n = normalizeMailHost(account.imap.host);
                    if (n && n !== account.imap.host) setImap({ host: n });
                  }}
                  placeholder="amsr200.websitehostserver.net"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Port</Label>
                <Input
                  className="h-9"
                  type="number"
                  value={account.imap.port || ""}
                  onChange={(e) => setImap({ port: Number(e.target.value) || 0 })}
                />
              </div>
              <div className="flex items-end pb-1 gap-2">
                <Switch
                  id="imap-secure"
                  checked={account.imap.secure}
                  onCheckedChange={(v) => setImap({ secure: !!v })}
                />
                <Label htmlFor="imap-secure" className="text-xs cursor-pointer">
                  TLS (typical for 993)
                </Label>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Username</Label>
                <Input
                  className="h-9"
                  value={account.imap.user}
                  onChange={(e) => setImap({ user: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Password</Label>
                <Input
                  className="h-9"
                  type="password"
                  autoComplete="new-password"
                  value={account.imap.password}
                  onChange={(e) => setImap({ password: e.target.value })}
                />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label className="text-xs">Sync interval (minutes)</Label>
                <Input
                  className="h-9 max-w-[120px]"
                  type="number"
                  min={5}
                  value={account.syncIntervalMinutes}
                  onChange={(e) =>
                    setAccount({ syncIntervalMinutes: Math.max(5, Number(e.target.value) || 15) })
                  }
                />
                <p className="text-[11px] text-muted-foreground">
                  Used when server-side IMAP polling ships. Minimum 5 minutes recommended.
                </p>
              </div>
            </div>
          </div>

          <Separator />

          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
              <div className="flex items-center gap-2">
                <Switch
                  id="archive-send"
                  checked={account.archiveOnSend}
                  onCheckedChange={(v) => setAccount({ archiveOnSend: !!v })}
                />
                <Label htmlFor="archive-send" className="text-xs cursor-pointer">
                  Archive on send (future)
                </Label>
              </div>
              <div className="flex items-center gap-2">
                <Switch
                  id="read-rcpt"
                  checked={account.readReceipts}
                  onCheckedChange={(v) => setAccount({ readReceipts: !!v })}
                />
                <Label htmlFor="read-rcpt" className="text-xs cursor-pointer">
                  Read receipts (future)
                </Label>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Email signature</Label>
              <Textarea
                rows={4}
                value={account.signature}
                onChange={(e) => setAccount({ signature: e.target.value })}
                placeholder="&#10;James Mitchell&#10;Director, Nova Inc."
                className="text-sm resize-y min-h-[88px]"
              />
            </div>
          </div>

          <p className="text-[11px] text-muted-foreground">
            Settings save automatically in this browser. Use an app-specific password for Gmail / Microsoft when 2FA
            is on.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
