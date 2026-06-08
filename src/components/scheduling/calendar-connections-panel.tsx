"use client";

import * as React from "react";
import { useSearchParams } from "next/navigation";
import { Calendar, RefreshCw, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { GoogleConnectButton } from "@/components/scheduling/google-connect-button";
import {
  connectGoogleCalendarClient,
  isGoogleCalendarConnectRedirect,
} from "@/lib/scheduling/connect-google-calendar-client";
import { syncGoogleCalendarClient } from "@/lib/scheduling/sync-google-calendar-client";
import { useCalendarConnections } from "@/lib/scheduling/use-calendar-connections";
import { useWorkspace } from "@/components/providers/workspace-mode-provider";
import { fmtRelative } from "@/lib/format";
import { cn } from "@/lib/utils";
import { formatFirebaseAuthError } from "@/lib/firebase/auth-errors";
import { isFirebaseWebConfigured } from "@/lib/firebase/config";

export function CalendarConnectionsPanel({ isDemo }: { isDemo: boolean }) {
  const searchParams = useSearchParams();
  const { currentUserId } = useWorkspace();
  const {
    connections,
    oauth,
    loading,
    refreshing,
    load,
    patchConnection,
    removeConnection,
  } = useCalendarConnections(isDemo, currentUserId);
  const [connectingGoogle, setConnectingGoogle] = React.useState(false);
  const [syncingId, setSyncingId] = React.useState<string | null>(null);

  React.useEffect(() => {
    const connected = searchParams.get("calendar_connected");
    const err = searchParams.get("calendar_error");
    if (connected === "google") {
      toast.success("Google Calendar connected");
      void load({ background: true });
    } else if (err) {
      toast.error("Could not connect calendar", {
        description: err.replace(/_/g, " "),
      });
    }
  }, [searchParams, load]);

  async function connectGoogle() {
    if (isDemo) {
      toast.message("Demo mode", { description: "Calendar sync works in live mode with Google sign-in." });
      return;
    }

    if (!oauth.google && !isFirebaseWebConfigured()) {
      toast.error("Google Calendar connect is not configured.");
      return;
    }

    setConnectingGoogle(true);
    try {
      const connectResult = await connectGoogleCalendarClient({
        googleMethod: oauth.googleMethod,
        googleCalendarClientId: oauth.googleCalendarClientId,
        preferAnyGoogleAccount: true,
      });
      if (isGoogleCalendarConnectRedirect(connectResult)) return;
      const tokens = connectResult;
      const res = await fetch("/api/scheduling/calendar-connections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: "google",
          accessToken: tokens.accessToken,
          accountEmail: tokens.accountEmail,
          expiresInSec: tokens.expiresInSec,
        }),
      });
      const j = await res.json();
      if (!j.ok) {
        toast.error(j.error ?? "Could not save calendar connection");
        return;
      }
      toast.success("Google Calendar connected", {
        description: tokens.accountEmail,
      });
      void load({ background: true });
    } catch (e: unknown) {
      toast.error(formatFirebaseAuthError(e));
    } finally {
      setConnectingGoogle(false);
    }
  }

  async function disconnect(id: string) {
    if (isDemo) {
      removeConnection(id);
      toast.success("Disconnected (demo)");
      return;
    }
    const res = await fetch(`/api/scheduling/calendar-connections?id=${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
    const j = await res.json();
    if (!j.ok) {
      toast.error(j.error ?? "Could not disconnect");
      return;
    }
    removeConnection(id);
    toast.success("Calendar disconnected");
  }

  async function syncNow(connectionId: string, forceRefresh = false) {
    if (isDemo) {
      toast.message("Demo mode", { description: "Calendar sync works in live mode with Google sign-in." });
      return;
    }
    setSyncingId(connectionId);
    try {
      const result = await syncGoogleCalendarClient({ forceRefresh });
      if ("redirecting" in result && result.redirecting) return;
      if (result.ok) {
        toast.success(
          result.eventCount === 0
            ? "Google Calendar synced — no upcoming events found"
            : `Synced ${result.eventCount} event${result.eventCount === 1 ? "" : "s"} from Google Calendar`,
          result.refreshedAccess
            ? { description: "Google access was refreshed." }
            : undefined,
        );
        void load({ background: true });
        return;
      }
      toast.error(result.error ?? "Could not sync Google Calendar", {
        description: result.needsReconnect
          ? "Try Sync now again to refresh Google access."
          : undefined,
      });
    } finally {
      setSyncingId(null);
    }
  }

  async function toggleSetting(
    id: string,
    field: "includeBuffers" | "syncExternalChanges",
    value: boolean,
  ) {
    if (isDemo) {
      patchConnection(id, { [field]: value });
      return;
    }
    const res = await fetch("/api/scheduling/calendar-connections", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, [field]: value }),
    });
    const j = await res.json();
    if (j.ok) {
      patchConnection(id, j.item);
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Calendars to check for conflicts</CardTitle>
          <CardDescription>
            Connect Google or Outlook so Nova knows when you are busy and avoids double-booking.
            {refreshing && !loading ? (
              <span className="ml-2 inline-flex items-center gap-1 text-xs">
                <RefreshCw className="h-3 w-3 animate-spin" />
                Refreshing…
              </span>
            ) : null}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {loading && connections.length === 0 ? (
            <p className="text-sm text-muted-foreground">Loading connections…</p>
          ) : connections.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No calendar connected yet. Add your Google or Microsoft account below.
            </p>
          ) : (
            <ul className="space-y-3">
              {connections.map((c) => (
                <li key={c.id} className="rounded-lg border p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex gap-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted text-lg font-semibold">
                        {c.provider === "google" ? "G" : "M"}
                      </div>
                      <div>
                        <p className="font-medium capitalize">{c.provider} Calendar</p>
                        <p className="text-sm text-muted-foreground">{c.accountEmail}</p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          Checking {c.checkCalendarLabel ?? "primary calendar"}
                          {c.lastSyncAt ? ` · last synced ${fmtRelative(c.lastSyncAt)}` : ""}
                        </p>
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-8 gap-1.5"
                        disabled={syncingId === c.id}
                        onClick={() => void syncNow(c.id)}
                      >
                        <RefreshCw
                          className={cn("h-3.5 w-3.5", syncingId === c.id && "animate-spin")}
                        />
                        Sync now
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label="Disconnect"
                        onClick={() => void disconnect(c.id)}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                  <div className="mt-4 space-y-2">
                    <label className="flex items-center gap-2 text-sm">
                      <Checkbox
                        checked={c.includeBuffers}
                        onCheckedChange={(v) =>
                          void toggleSetting(c.id, "includeBuffers", Boolean(v))
                        }
                      />
                      Include buffers on this calendar
                    </label>
                    <label className="flex items-center gap-2 text-sm">
                      <Checkbox
                        checked={c.syncExternalChanges}
                        onCheckedChange={(v) =>
                          void toggleSetting(c.id, "syncExternalChanges", Boolean(v))
                        }
                      />
                      Automatically sync changes from this calendar to Nova
                    </label>
                  </div>
                </li>
              ))}
            </ul>
          )}

          <div className="flex flex-wrap items-center gap-2 pt-2">
            <GoogleConnectButton
              label="Sign in with Google"
              loading={connectingGoogle}
              disabled={!isDemo && !oauth.google}
              onClick={() => void connectGoogle()}
            />
            <Button
              variant="outline"
              disabled={!oauth.microsoft && !isDemo}
              onClick={() =>
                toast.message("Microsoft Outlook", {
                  description: oauth.microsoft
                    ? "Outlook connect flow coming in the next update."
                    : "Microsoft calendar connect is not configured yet.",
                })
              }
            >
              <Calendar className="h-4 w-4" />
              Connect Microsoft Outlook
            </Button>
          </div>
          {!isDemo && oauth.google && (
            <p className="text-xs text-muted-foreground">
              {oauth.googleMethod === "oauth" || oauth.googleMethod === "gis"
                ? "Your Nova login and Google Calendar can be different accounts — pick whichever Google account has the calendar you want."
                : "Without a Google Calendar client id, email/password Nova users can connect a different Google account. Google Nova sign-in must use the same Google account unless you add GOOGLE_CALENDAR_CLIENT_ID (see .env.example)."}
              {" "}
              Reconnect if sync stops after about an hour.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Calendar to add events to</CardTitle>
          <CardDescription>
            When someone books via your link, the meeting is created on your connected primary calendar.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {connections[0] ? (
            <p className="text-sm">
              <span className="font-medium">{connections[0].accountEmail}</span>
              <span className="text-muted-foreground">, primary calendar</span>
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">
              Connect a calendar above first.
            </p>
          )}
        </CardContent>
      </Card>

      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <RefreshCw className="h-3.5 w-3.5" />
        Use Sync now to pull events from Google Calendar. Access expires after about an hour — Sync now will refresh it automatically.
      </div>
    </div>
  );
}
