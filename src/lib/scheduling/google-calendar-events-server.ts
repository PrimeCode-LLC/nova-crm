import { FieldValue } from "firebase-admin/firestore";
import { getAdminDb } from "@/lib/firebase/admin";
import { COLLECTIONS } from "@/lib/firestore/collections";
import type { CalendarProvider, ExternalCalendarEvent } from "@/lib/types";

type ConnectionCredentials = {
  id: string;
  provider: CalendarProvider;
  accountEmail: string;
  accessToken?: string;
  refreshToken?: string;
  tokenExpiresAt?: string;
};

async function getHostConnectionCredentials(input: {
  organizationId: string;
  hostUid: string;
}): Promise<ConnectionCredentials[]> {
  const db = getAdminDb();
  if (!db) return [];
  const snap = await db
    .collection(COLLECTIONS.calendarConnections)
    .where("organizationId", "==", input.organizationId)
    .where("ownerUid", "==", input.hostUid)
    .where("status", "==", "connected")
    .get();
  return snap.docs.map((d) => {
    const data = d.data();
    return {
      id: d.id,
      provider: (data.provider as CalendarProvider) ?? "google",
      accountEmail: String(data.accountEmail ?? ""),
      accessToken: typeof data.accessToken === "string" ? data.accessToken : undefined,
      refreshToken: typeof data.refreshToken === "string" ? data.refreshToken : undefined,
      tokenExpiresAt:
        typeof data.tokenExpiresAt === "string" ? data.tokenExpiresAt : undefined,
    };
  });
}

async function refreshGoogleAccessToken(refreshToken: string): Promise<{
  accessToken: string;
  expiresAt: string;
} | null> {
  const clientId = process.env.GOOGLE_CALENDAR_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_CALENDAR_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) return null;

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) return null;
  const tokens = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!tokens.access_token) return null;
  const expiresAt = tokens.expires_in
    ? new Date(Date.now() + tokens.expires_in * 1000).toISOString()
    : new Date(Date.now() + 3600 * 1000).toISOString();
  return { accessToken: tokens.access_token, expiresAt };
}

async function resolveAccessToken(
  conn: ConnectionCredentials,
): Promise<{ token: string } | { error: "expired" | "missing" }> {
  const now = Date.now();
  const expiresMs = conn.tokenExpiresAt ? new Date(conn.tokenExpiresAt).getTime() : 0;
  const stillValid = conn.accessToken && expiresMs > now + 60_000;

  if (stillValid && conn.accessToken) {
    return { token: conn.accessToken };
  }

  if (conn.refreshToken) {
    const refreshed = await refreshGoogleAccessToken(conn.refreshToken);
    if (refreshed) {
      const db = getAdminDb();
      if (db) {
        await db.collection(COLLECTIONS.calendarConnections).doc(conn.id).update({
          accessToken: refreshed.accessToken,
          tokenExpiresAt: refreshed.expiresAt,
          updatedAt: FieldValue.serverTimestamp(),
        });
      }
      return { token: refreshed.accessToken };
    }
  }

  if (conn.accessToken) {
    // Token may still work even if expiry metadata is stale (Firebase popup flow).
    const probe = await fetch(
      `https://www.googleapis.com/oauth2/v1/tokeninfo?access_token=${encodeURIComponent(conn.accessToken)}`,
    );
    if (probe.ok) return { token: conn.accessToken };
  }

  return { error: conn.accessToken ? "expired" : "missing" };
}

function parseGoogleEvent(
  raw: Record<string, unknown>,
  accountEmail: string,
): ExternalCalendarEvent | null {
  const id = typeof raw.id === "string" ? raw.id : null;
  if (!id) return null;

  const summary = typeof raw.summary === "string" ? raw.summary : "(No title)";
  const startObj = raw.start as { dateTime?: string; date?: string } | undefined;
  const endObj = raw.end as { dateTime?: string; date?: string } | undefined;
  if (!startObj || !endObj) return null;

  const allDay = Boolean(startObj.date && !startObj.dateTime);
  let startAt: string;
  let endAt: string;

  if (allDay && startObj.date) {
    startAt = new Date(`${startObj.date}T00:00:00`).toISOString();
    const endDate = endObj.date ?? startObj.date;
    endAt = new Date(`${endDate}T23:59:59`).toISOString();
  } else if (startObj.dateTime && endObj.dateTime) {
    startAt = new Date(startObj.dateTime).toISOString();
    endAt = new Date(endObj.dateTime).toISOString();
  } else {
    return null;
  }

  return {
    id: `google:${id}`,
    provider: "google",
    accountEmail,
    title: summary,
    startAt,
    endAt,
    allDay,
  };
}

async function fetchGoogleEvents(input: {
  conn: ConnectionCredentials;
  from: string;
  to: string;
}): Promise<{ events: ExternalCalendarEvent[] } | { error: "expired" | "missing" | "api" }> {
  const tokenResult = await resolveAccessToken(input.conn);
  if ("error" in tokenResult) return { error: tokenResult.error };

  const params = new URLSearchParams({
    timeMin: input.from,
    timeMax: input.to,
    singleEvents: "true",
    orderBy: "startTime",
    maxResults: "250",
  });

  const res = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/primary/events?${params.toString()}`,
    { headers: { Authorization: `Bearer ${tokenResult.token}` } },
  );

  if (res.status === 401) return { error: "expired" };
  if (!res.ok) return { error: "api" };

  const body = (await res.json()) as { items?: Record<string, unknown>[] };
  const events = (body.items ?? [])
    .map((item) => parseGoogleEvent(item, input.conn.accountEmail))
    .filter((e): e is ExternalCalendarEvent => e !== null);

  const db = getAdminDb();
  if (db) {
    await db.collection(COLLECTIONS.calendarConnections).doc(input.conn.id).update({
      lastSyncAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
  }

  return { events };
}

export async function listExternalCalendarEventsServer(input: {
  organizationId: string;
  hostUid: string;
  from: string;
  to: string;
}): Promise<{
  events: ExternalCalendarEvent[];
  needsReconnect: boolean;
  connectionCount: number;
  syncedConnectionCount: number;
}> {
  const connections = await getHostConnectionCredentials({
    organizationId: input.organizationId,
    hostUid: input.hostUid,
  });

  const events: ExternalCalendarEvent[] = [];
  let needsReconnect = false;
  let syncedConnectionCount = 0;

  for (const conn of connections) {
    if (conn.provider !== "google") continue;
    const result = await fetchGoogleEvents({ conn, from: input.from, to: input.to });
    if ("error" in result) {
      if (result.error === "expired" || result.error === "missing") needsReconnect = true;
      continue;
    }
    syncedConnectionCount += 1;
    events.push(...result.events);
  }

  events.sort((a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime());
  return {
    events,
    needsReconnect,
    connectionCount: connections.filter((c) => c.provider === "google").length,
    syncedConnectionCount,
  };
}

/** Pull Google Calendar events for a wide window and refresh lastSyncAt. */
export async function syncHostCalendarServer(input: {
  organizationId: string;
  hostUid: string;
}): Promise<{
  ok: boolean;
  eventCount: number;
  needsReconnect: boolean;
  connectionCount: number;
  lastSyncAt?: string;
  error?: string;
}> {
  const from = new Date();
  from.setDate(from.getDate() - 30);
  const to = new Date();
  to.setDate(to.getDate() + 90);

  const result = await listExternalCalendarEventsServer({
    organizationId: input.organizationId,
    hostUid: input.hostUid,
    from: from.toISOString(),
    to: to.toISOString(),
  });

  if (result.connectionCount === 0) {
    return {
      ok: false,
      eventCount: 0,
      needsReconnect: false,
      connectionCount: 0,
      error: "No Google Calendar connected for this user.",
    };
  }

  if (result.syncedConnectionCount === 0 && result.needsReconnect) {
    return {
      ok: false,
      eventCount: 0,
      needsReconnect: true,
      connectionCount: result.connectionCount,
      error: "Google Calendar access expired. Sync again to refresh access.",
    };
  }

  return {
    ok: true,
    eventCount: result.events.length,
    needsReconnect: result.needsReconnect,
    connectionCount: result.connectionCount,
    lastSyncAt: new Date().toISOString(),
  };
}
