"use client";

import * as React from "react";
import { Check, Copy, ExternalLink, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { InstantlyAccountsPanel } from "@/components/integrations/instantly-accounts-panel";

type ConnectionState = {
  connected: boolean;
  encryptionConfigured: boolean;
  webhookUrl: string;
  hasWebhookSecret: boolean;
};

export function InstantlyIntegrationCard() {
  const [loading, setLoading] = React.useState(true);
  const [state, setState] = React.useState<ConnectionState | null>(null);
  const [apiKey, setApiKey] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const [disconnecting, setDisconnecting] = React.useState(false);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/integrations/instantly/connection");
      if (!res.ok) {
        setState(null);
        return;
      }
      const data = (await res.json()) as ConnectionState;
      setState(data);
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  async function connect() {
    const key = apiKey.trim();
    if (key.length < 8) {
      toast.error("Enter a valid Instantly API key");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/integrations/instantly/connection", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey: key }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(typeof data.error === "string" ? data.error : "Could not connect");
        return;
      }
      toast.success("Instantly connected");
      setApiKey("");
      await load();
    } finally {
      setSaving(false);
    }
  }

  async function disconnect() {
    setDisconnecting(true);
    try {
      const res = await fetch("/api/integrations/instantly/connection", { method: "DELETE" });
      if (!res.ok) {
        toast.error("Could not disconnect");
        return;
      }
      toast.success("Instantly disconnected");
      await load();
    } finally {
      setDisconnecting(false);
    }
  }

  async function copyWebhook() {
    if (!state?.webhookUrl) return;
    try {
      await navigator.clipboard.writeText(state.webhookUrl);
      toast.success("Webhook URL copied");
    } catch {
      toast.error("Could not copy");
    }
  }

  const connected = state?.connected ?? false;

  return (
    <Card>
      <CardContent className="p-4 flex flex-col gap-4">
        <div className="flex items-center gap-4">
          <div className="flex h-9 w-9 items-center justify-center rounded-md bg-muted text-muted-foreground font-semibold text-sm shrink-0">
            I
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">Instantly</span>
              <Badge
                variant="outline"
                className={`text-[10px] ${
                  connected
                    ? "bg-success/10 text-success border-success/20"
                    : "bg-muted text-muted-foreground"
                }`}
              >
                {loading ? (
                  "…"
                ) : connected ? (
                  <>
                    <Check className="h-2.5 w-2.5" /> Connected
                  </>
                ) : (
                  <>
                    <X className="h-2.5 w-2.5" /> Not connected
                  </>
                )}
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              Cold email automation: create campaigns, push leads, and sync replies into Nova.
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="shrink-0"
            nativeButton={false}
            render={
              <a
                href="https://app.instantly.ai/app/settings/integrations"
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-2"
              >
                <ExternalLink className="h-3.5 w-3.5" /> Instantly
              </a>
            }
          />
        </div>

        {state && !state.encryptionConfigured && (
          <p className="text-xs text-warning">
            Server encryption key (AI_SECRETS_KEY_BASE64) is not configured — API keys cannot be stored.
          </p>
        )}

        {!connected ? (
          <div className="grid gap-2 max-w-md">
            <Label htmlFor="instantly-api-key" className="text-xs">
              API key
            </Label>
            <Input
              id="instantly-api-key"
              type="password"
              placeholder="Paste from Instantly → Settings → Integrations → API"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              className="font-mono text-xs"
            />
            <Button size="sm" className="w-fit" disabled={saving || loading} onClick={() => void connect()}>
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
              Connect Instantly
            </Button>
          </div>
        ) : (
          <div className="space-y-3 max-w-lg">
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={disconnecting}
                onClick={() => void disconnect()}
              >
                {disconnecting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                Disconnect
              </Button>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Webhook URL (paste in Instantly → Webhooks)</Label>
              <div className="flex gap-2">
                <Input readOnly value={state?.webhookUrl ?? ""} className="font-mono text-[10px] h-8" />
                <Button type="button" variant="outline" size="sm" onClick={() => void copyWebhook()}>
                  <Copy className="h-3.5 w-3.5" />
                </Button>
              </div>
              <p className="text-[10px] text-muted-foreground">
                Enable: reply_received, email_sent, email_opened. Use header{" "}
                <code className="rounded bg-muted px-1">x-webhook-secret</code> with the secret generated on connect.
              </p>
            </div>
          </div>
        )}
        {connected && <InstantlyAccountsPanel connected />}
      </CardContent>
    </Card>
  );
}
