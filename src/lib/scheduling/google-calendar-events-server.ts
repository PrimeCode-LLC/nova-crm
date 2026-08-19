import { FieldValue } from "@/lib/db/document-shim/shim-firestore";
import { getAdminDb } from "@/lib/db/document-access/admin";
import { COLLECTIONS } from "@/lib/documents/collections";
import type { CalendarProvider, ExternalCalendarEvent } from "@/lib/types";

type ConnectionCredentials = {
  id: string;
  provider: CalendarProvider;
  accountEmail: string;
  accessToken?: string;
  refreshToken?: string;
  tokenExpiresAt?: string;
  writeCalendarId?: string;
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
      writeCalendarId: "primary",
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

export type GoogleCalendarEventWriteInput = {
  organizationId: string;
  hostUid: string;
  summary: string;
  description?: string;
  location?: string;
  startAt: string;
  endAt: string;
  timezone?: string;
  /** Invite these emails on the Google event (primary host typically). */
  attendeeEmails?: string[];
  /** When true, Google sends invitation emails to attendees. */
  sendUpdates?: boolean;
};

export async function insertGoogleCalendarEventServer(
  input: GoogleCalendarEventWriteInput,
): Promise<
  | { ok: true; eventId: string; htmlLink?: string; hangoutLink?: string }
  | { ok: false; error: string; needsReconnect?: boolean }
> {
  const connections = await getHostConnectionCredentials({
    organizationId: input.organizationId,
    hostUid: input.hostUid,
  });
  const conn = connections.find((c) => c.provider === "google");
  if (!conn) {
    return { ok: false, error: "No Google Calendar connected for this user." };
  }

  const tokenResult = await resolveAccessToken(conn);
  if ("error" in tokenResult) {
    return {
      ok: false,
      error: "Google Calendar access expired. Reconnect Google Calendar.",
      needsReconnect: true,
    };
  }

  const calendarId = encodeURIComponent(conn.writeCalendarId || "primary");
  const body: Record<string, unknown> = {
    summary: input.summary,
    description: input.description ?? "",
    location: input.location ?? "",
    start: {
      dateTime: input.startAt,
      timeZone: input.timezone || "UTC",
    },
    end: {
      dateTime: input.endAt,
      timeZone: input.timezone || "UTC",
    },
  };
  if (input.attendeeEmails?.length) {
    body.attendees = input.attendeeEmails.map((email) => ({
      email: email.trim().toLowerCase(),
    }));
  }

  const params = new URLSearchParams();
  if (input.sendUpdates && input.attendeeEmails?.length) {
    params.set("sendUpdates", "all");
  }

  const url = `https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events${
    params.toString() ? `?${params.toString()}` : ""
  }`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${tokenResult.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (res.status === 401) {
    return {
      ok: false,
      error: "Google Calendar access expired. Reconnect Google Calendar.",
      needsReconnect: true,
    };
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    return {
      ok: false,
      error: detail.slice(0, 300) || `Google Calendar write failed (${res.status})`,
    };
  }

  const created = (await res.json()) as {
    id?: string;
    htmlLink?: string;
    hangoutLink?: string;
  };
  if (!created.id) {
    return { ok: false, error: "Google Calendar did not return an event id." };
  }

  return {
    ok: true,
    eventId: created.id,
    htmlLink: created.htmlLink,
    hangoutLink: created.hangoutLink,
  };
}

export async function deleteGoogleCalendarEventServer(input: {
  organizationId: string;
  hostUid: string;
  eventId: string;
}): Promise<{ ok: true } | { ok: false; error: string; needsReconnect?: boolean }> {
  const connections = await getHostConnectionCredentials({
    organizationId: input.organizationId,
    hostUid: input.hostUid,
  });
  const conn = connections.find((c) => c.provider === "google");
  if (!conn) {
    return { ok: false, error: "No Google Calendar connected for this user." };
  }

  const tokenResult = await resolveAccessToken(conn);
  if ("error" in tokenResult) {
    return {
      ok: false,
      error: "Google Calendar access expired. Reconnect Google Calendar.",
      needsReconnect: true,
    };
  }

  const calendarId = encodeURIComponent(conn.writeCalendarId || "primary");
  const eventId = encodeURIComponent(input.eventId);
  const res = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events/${eventId}`,
    {
      method: "DELETE",
      headers: { Authorization: `Bearer ${tokenResult.token}` },
    },
  );

  if (res.status === 401) {
    return {
      ok: false,
      error: "Google Calendar access expired. Reconnect Google Calendar.",
      needsReconnect: true,
    };
  }
  if (res.status === 404 || res.status === 410) {
    return { ok: true };
  }
  if (!res.ok && res.status !== 204) {
    const detail = await res.text().catch(() => "");
    return {
      ok: false,
      error: detail.slice(0, 300) || `Google Calendar delete failed (${res.status})`,
    };
  }
  return { ok: true };
}

/** Insert the same event onto each host's Google calendar. Primary host may invite the client. */
export async function insertGoogleEventsForHostsServer(input: {
  organizationId: string;
  hostIds: string[];
  primaryHostId: string;
  summary: string;
  description?: string;
  location?: string;
  startAt: string;
  endAt: string;
  timezone?: string;
  clientAttendeeEmail?: string;
  sendClientInviteOnPrimary?: boolean;
}): Promise<{
  googleEventIdsByHost: Record<string, string>;
  errors: { hostId: string; error: string; needsReconnect?: boolean }[];
}> {
  const googleEventIdsByHost: Record<string, string> = {};
  const errors: { hostId: string; error: string; needsReconnect?: boolean }[] = [];
  const uniqueHosts = [...new Set(input.hostIds.filter(Boolean))];

  for (const hostId of uniqueHosts) {
    const isPrimary = hostId === input.primaryHostId;
    const result = await insertGoogleCalendarEventServer({
      organizationId: input.organizationId,
      hostUid: hostId,
      summary: input.summary,
      description: input.description,
      location: input.location,
      startAt: input.startAt,
      endAt: input.endAt,
      timezone: input.timezone,
      attendeeEmails:
        isPrimary && input.sendClientInviteOnPrimary && input.clientAttendeeEmail
          ? [input.clientAttendeeEmail]
          : undefined,
      sendUpdates: Boolean(
        isPrimary && input.sendClientInviteOnPrimary && input.clientAttendeeEmail,
      ),
    });
    if (result.ok) {
      googleEventIdsByHost[hostId] = result.eventId;
    } else {
      errors.push({
        hostId,
        error: result.error,
        needsReconnect: result.needsReconnect,
      });
    }
  }

  return { googleEventIdsByHost, errors };
}

