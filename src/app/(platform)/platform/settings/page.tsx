"use client";

import * as React from "react";
import Link from "next/link";
import { PauseCircle, PlayCircle } from "lucide-react";
import { toast } from "sonner";
import type { PlatformOpsSettings } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";

export default function PlatformSettingsPage() {
  const [settings, setSettings] = React.useState<PlatformOpsSettings | null>(null);
  const [envForced, setEnvForced] = React.useState(false);
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [reason, setReason] = React.useState("");
  const [confirmEnable, setConfirmEnable] = React.useState(false);
  const [confirmDisable, setConfirmDisable] = React.useState(false);

  const load = React.useCallback(async () => {
    const res = await fetch("/api/platform/settings", { cache: "no-store" });
    const data = (await res.json()) as {
      settings?: PlatformOpsSettings;
      envForced?: boolean;
      error?: string;
    };
    if (!res.ok) throw new Error(data.error ?? res.statusText);
    setSettings(data.settings ?? { backupOnlyMode: false });
    setEnvForced(Boolean(data.envForced));
    if (data.settings?.backupOnlyReason) setReason(data.settings.backupOnlyReason);
  }, []);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await load();
      } catch (e) {
        if (!cancelled) toast.error(e instanceof Error ? e.message : "Failed to load");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [load]);

  async function apply(enabled: boolean) {
    setSaving(true);
    try {
      const res = await fetch("/api/platform/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          backupOnlyMode: enabled,
          backupOnlyReason: enabled ? reason.trim() || undefined : undefined,
        }),
      });
      const data = (await res.json()) as { settings?: PlatformOpsSettings; error?: string };
      if (!res.ok) throw new Error(data.error ?? "Failed");
      setSettings(data.settings ?? { backupOnlyMode: enabled });
      toast.success(
        enabled
          ? "Backup only mode enabled — automation and live listeners paused"
          : "Backup only mode disabled — automation may resume",
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setSaving(false);
      setConfirmEnable(false);
      setConfirmDisable(false);
    }
  }

  const on = settings?.backupOnlyMode === true;

  return (
    <div className="space-y-8">
      <div>
        <Link href="/platform" className="text-xs text-muted-foreground hover:text-foreground">
          ← Platform overview
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">Ops / spend controls</h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          Pause Firebase automation and live listeners when this project is backup-only. Soft pause
          stops scrapers, IMAP, scheduled email, and client <code className="rounded bg-muted px-1">onSnapshot</code>{" "}
          traffic. For the lowest bill, also undeploy Cloud Functions / App Hosting in Google Cloud
          after enabling this.
        </p>
      </div>

      <Card className={on ? "border-amber-500/40" : undefined}>
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-2 text-base">
            {on ? (
              <PauseCircle className="h-4 w-4 text-amber-600" />
            ) : (
              <PlayCircle className="h-4 w-4" />
            )}
            Backup only mode
            {loading ? null : (
              <Badge variant={on ? "secondary" : "outline"}>{on ? "On" : "Off"}</Badge>
            )}
          </CardTitle>
          <CardDescription>
            Instant soft kill-switch for spend. Does not delete data. Storage charges remain until you
            export and remove the database.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {envForced ? (
            <p className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm">
              Forced on by <code className="rounded bg-muted px-1">PLATFORM_BACKUP_ONLY</code> in the
              server environment. Clear that env var to allow disabling from this UI.
            </p>
          ) : null}

          <div className="space-y-2">
            <Label htmlFor="backup-reason">Operator note (optional)</Label>
            <Textarea
              id="backup-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Staging Firebase kept for RAG / old lead lookups only"
              rows={2}
              disabled={envForced || saving}
            />
          </div>

          <div className="flex flex-wrap gap-2">
            {on ? (
              <Button
                type="button"
                variant="default"
                disabled={loading || saving || envForced}
                onClick={() => setConfirmDisable(true)}
              >
                Resume live operations
              </Button>
            ) : (
              <Button
                type="button"
                variant="destructive"
                disabled={loading || saving}
                onClick={() => setConfirmEnable(true)}
              >
                Enable Backup only
              </Button>
            )}
            <Link href="/platform" className={cn(buttonVariants({ variant: "ghost", size: "default" }))}>
              Cancel
            </Link>
          </div>

          {settings?.updatedAt ? (
            <p className="text-xs text-muted-foreground">
              Last updated {settings.updatedAt}
              {settings.updatedByUid ? ` by ${settings.updatedByUid}` : ""}
            </p>
          ) : null}

          <div className="rounded-md border bg-muted/40 px-3 py-3 text-xs text-muted-foreground space-y-2">
            <p className="font-medium text-foreground">What this turns off</p>
            <ul className="list-disc pl-4 space-y-1">
              <li>Cron: scrapers, IMAP sync, scheduled emails, content capture reminders</li>
              <li>Cloud Functions skip calling App Hosting when the flag is set</li>
              <li>CRM live Firestore listeners (workspace lists stay empty until resumed)</li>
              <li>Dev scheduled-email poller and other deferred background sync</li>
            </ul>
            <p className="font-medium text-foreground pt-1">Hard pause (manual, biggest $ cut)</p>
            <ul className="list-disc pl-4 space-y-1">
              <li>Delete or undeploy scheduled Cloud Functions + App Hosting for this project</li>
              <li>Disable PITR / automated Firestore backups if you already have an export</li>
              <li>Set a GCP budget alert at $10 / $20</li>
            </ul>
          </div>
        </CardContent>
      </Card>

      <AlertDialog open={confirmEnable} onOpenChange={setConfirmEnable}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Enable Backup only mode?</AlertDialogTitle>
            <AlertDialogDescription>
              Automation and live listeners will stop within about a minute. Open CRM tabs will show
              empty live lists until you resume. This does not undeploy Cloud Functions by itself.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={saving}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={saving}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={(e) => {
                e.preventDefault();
                void apply(true);
              }}
            >
              Enable Backup only
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmDisable} onOpenChange={setConfirmDisable}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Resume live operations?</AlertDialogTitle>
            <AlertDialogDescription>
              Crons and live listeners will start again. Confirm Cloud Functions / App Hosting are
              still what you intend to run before continuing.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={saving}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={saving}
              onClick={(e) => {
                e.preventDefault();
                void apply(false);
              }}
            >
              Resume
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
