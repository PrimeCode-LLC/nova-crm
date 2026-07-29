"use client";

import * as React from "react";
import { Check, ExternalLink, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";

type ConnectionState = {
  connected: boolean;
  encryptionConfigured: boolean;
  credits?: number | null;
};

export function MillionVerifierIntegrationCard() {
  const [loading, setLoading] = React.useState(true);
  const [state, setState] = React.useState<ConnectionState | null>(null);
  const [apiKey, setApiKey] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const [disconnecting, setDisconnecting] = React.useState(false);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/integrations/millionverifier/connection");
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
      toast.error("Enter a valid Million Verifier API key");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/integrations/millionverifier/connection", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey: key }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(typeof data.error === "string" ? data.error : "Could not connect");
        return;
      }
      toast.success("Million Verifier connected");
      setApiKey("");
      await load();
    } finally {
      setSaving(false);
    }
  }

  async function disconnect() {
    setDisconnecting(true);
    try {
      const res = await fetch("/api/integrations/millionverifier/connection", {
        method: "DELETE",
      });
      if (!res.ok) {
        toast.error("Could not disconnect");
        return;
      }
      toast.success("Million Verifier disconnected");
      await load();
    } finally {
      setDisconnecting(false);
    }
  }

  const connected = state?.connected ?? false;

  return (
    <Card>
      <CardContent className="p-4 flex flex-col gap-4">
        <div className="flex items-center gap-4">
          <div className="flex h-9 w-9 items-center justify-center rounded-md bg-muted text-muted-foreground font-semibold text-sm shrink-0">
            MV
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">Million Verifier</span>
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
              Verify prospect company emails (single or bulk) before outreach.
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="shrink-0"
            nativeButton={false}
            render={
              <a
                href="https://app.millionverifier.com/api"
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-2"
              >
                <ExternalLink className="h-3.5 w-3.5" /> API key
              </a>
            }
          />
        </div>

        {state && !state.encryptionConfigured && (
          <p className="text-xs text-warning">
            Server encryption key (AI_SECRETS_KEY_BASE64) is not configured, API keys cannot be
            stored.
          </p>
        )}

        {!connected ? (
          <div className="grid gap-2 max-w-md">
            <Label htmlFor="millionverifier-api-key" className="text-xs">
              API key
            </Label>
            <Input
              id="millionverifier-api-key"
              type="password"
              placeholder="Paste from Million Verifier → API"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              className="font-mono text-xs"
            />
            <Button
              size="sm"
              className="w-fit"
              disabled={saving || loading || !state?.encryptionConfigured}
              onClick={() => void connect()}
            >
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
              Connect Million Verifier
            </Button>
          </div>
        ) : (
          <div className="space-y-3 max-w-lg">
            {typeof state?.credits === "number" ? (
              <p className="text-xs text-muted-foreground">
                Remaining credits:{" "}
                <span className="font-medium text-foreground">
                  {state.credits.toLocaleString()}
                </span>
              </p>
            ) : null}
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
        )}
      </CardContent>
    </Card>
  );
}
