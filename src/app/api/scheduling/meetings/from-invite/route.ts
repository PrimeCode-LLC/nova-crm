import { NextResponse } from "next/server";
import { z } from "zod";
import { guardTenantApi } from "@/lib/platform/tenant-api-guard";
import { placeMeetingServer } from "@/lib/scheduling/place-meeting-server";
import {
  buildMeetingIcsReply,
  parseInboundIcs,
  type IcsPartstat,
} from "@/lib/scheduling/ics";
import { DEFAULT_TIMEZONE } from "@/lib/scheduling/defaults";

const schema = z.object({
  action: z.enum(["accept", "decline", "tentative"]),
  icsText: z.string().min(10).max(200_000),
  hostIds: z.array(z.string().min(1)).max(20).optional(),
  attendeeEmail: z.string().email(),
  attendeeName: z.string().max(120).optional(),
  leadId: z.string().optional(),
  leadOwnerId: z.string().optional(),
  contactId: z.string().optional(),
  timezone: z.string().max(80).optional(),
});

function partstatForAction(action: "accept" | "decline" | "tentative"): IcsPartstat {
  if (action === "accept") return "ACCEPTED";
  if (action === "decline") return "DECLINED";
  return "TENTATIVE";
}

export async function POST(req: Request) {
  const g = await guardTenantApi();
  if (!g.ok) return g.response;

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "Invalid input" }, { status: 400 });
  }

  const invite = parseInboundIcs(parsed.data.icsText);
  if (!invite) {
    return NextResponse.json(
      { ok: false, error: "Could not parse calendar invite" },
      { status: 400 },
    );
  }
  if (invite.method && invite.method !== "REQUEST" && invite.method !== "PUBLISH") {
    return NextResponse.json(
      { ok: false, error: `Unsupported calendar method: ${invite.method}` },
      { status: 400 },
    );
  }

  const organizerEmail = invite.organizerEmail;
  if (!organizerEmail) {
    return NextResponse.json(
      { ok: false, error: "Invite is missing an organizer email" },
      { status: 400 },
    );
  }

  const partstat = partstatForAction(parsed.data.action);
  const replyIcs = buildMeetingIcsReply({
    uid: invite.uid,
    summary: invite.summary,
    startAt: invite.startAt,
    endAt: invite.endAt,
    organizerEmail,
    attendeeEmail: parsed.data.attendeeEmail.trim().toLowerCase(),
    attendeeName: parsed.data.attendeeName,
    partstat,
    description: invite.description,
    location: invite.location,
  });

  const replySubject =
    parsed.data.action === "accept"
      ? `Accepted: ${invite.summary}`
      : parsed.data.action === "decline"
        ? `Declined: ${invite.summary}`
        : `Tentative: ${invite.summary}`;

  if (parsed.data.action !== "accept") {
    return NextResponse.json({
      ok: true,
      action: parsed.data.action,
      replyIcs,
      replyTo: organizerEmail,
      replySubject,
      invite: {
        uid: invite.uid,
        summary: invite.summary,
        startAt: invite.startAt,
        endAt: invite.endAt,
        organizerEmail,
        organizerName: invite.organizerName,
        location: invite.location,
      },
    });
  }

  const hostIds = parsed.data.hostIds?.length
    ? parsed.data.hostIds
    : [g.ctx.session.uid];

  const placed = await placeMeetingServer({
    organizationId: g.ctx.session.organizationId,
    actorUid: g.ctx.session.uid,
    actorName: g.ctx.session.name,
    hostIds,
    title: invite.summary,
    startAt: invite.startAt,
    endAt: invite.endAt,
    timezone: parsed.data.timezone || DEFAULT_TIMEZONE,
    attendeeName: invite.organizerName || organizerEmail.split("@")[0] || "Guest",
    attendeeEmail: organizerEmail,
    attendeeNotes: invite.description,
    locationType: "custom",
    locationDetails: invite.location,
    source: "invite_rsvp",
    leadId: parsed.data.leadId,
    leadOwnerId: parsed.data.leadOwnerId ?? g.ctx.session.uid,
    contactId: parsed.data.contactId,
    inboundInviteUid: invite.uid,
    organizerEmail,
    sendClientGoogleInvite: false,
    writeGoogle: true,
  });

  if ("error" in placed) {
    const status = placed.error.includes("cannot book") ? 403 : 400;
    return NextResponse.json({ ok: false, error: placed.error }, { status });
  }

  return NextResponse.json({
    ok: true,
    action: "accept",
    meeting: placed.meeting,
    googleErrors: placed.googleErrors,
    replyIcs,
    replyTo: organizerEmail,
    replySubject,
    invite: {
      uid: invite.uid,
      summary: invite.summary,
      startAt: invite.startAt,
      endAt: invite.endAt,
      organizerEmail,
      organizerName: invite.organizerName,
      location: invite.location,
    },
  });
}
