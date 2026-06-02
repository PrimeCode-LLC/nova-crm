import { NextResponse } from "next/server";
import { z } from "zod";
import { CHANNELS } from "@/lib/constants";
import type {
  ChannelKey,
  OrganizationChannelAdminConfig,
  OrganizationCustomChannelRow,
} from "@/lib/types";
import { mergeChannelAdminConfig } from "@/lib/channel-admin-defaults";
import { guardTenantApi } from "@/lib/platform/tenant-api-guard";
import { guardAdminFeature } from "@/lib/platform/guard-admin-feature";
import {
  getOrganizationServer,
  updateOrganizationChannelAdminServer,
} from "@/lib/platform/organizations-server";
import { recordAudit } from "@/lib/firestore/audit";

const ALLOWED_KEYS = new Set(Object.keys(CHANNELS) as ChannelKey[]);

const stageSchema = z.object({
  key: z.string().min(1).max(80),
  label: z.string().min(1).max(200),
});

const customChannelSchema = z.object({
  id: z.string().min(1).max(80),
  name: z.string().min(1).max(120),
  description: z.string().max(2000),
  stages: z.array(stageSchema).max(40),
  auto: z.boolean(),
});

const putSchema = z
  .object({
    autoMap: z.record(z.string(), z.boolean()),
    descriptionOverrides: z.record(z.string(), z.string()).optional(),
    customChannels: z.array(customChannelSchema).max(50),
  })
  .strict();

function sanitizeChannelAdminInput(
  parsed: z.infer<typeof putSchema>,
): OrganizationChannelAdminConfig {
  const autoMap: Partial<Record<ChannelKey, boolean>> = {};
  for (const [k, v] of Object.entries(parsed.autoMap)) {
    if (ALLOWED_KEYS.has(k as ChannelKey)) autoMap[k as ChannelKey] = v;
  }
  const descriptionOverrides: Partial<Record<ChannelKey, string>> = {};
  if (parsed.descriptionOverrides) {
    for (const [k, v] of Object.entries(parsed.descriptionOverrides)) {
      if (ALLOWED_KEYS.has(k as ChannelKey) && typeof v === "string") {
        descriptionOverrides[k as ChannelKey] = v;
      }
    }
  }
  return mergeChannelAdminConfig({
    autoMap,
    descriptionOverrides,
    customChannels: parsed.customChannels,
  });
}

function mergeMemberChannelAdminPut(
  base: OrganizationChannelAdminConfig,
  incoming: OrganizationChannelAdminConfig,
): { ok: true; merged: OrganizationChannelAdminConfig } | { ok: false; status: 403 | 400; error: string } {
  const seenIds = new Set<string>();
  for (const c of incoming.customChannels) {
    if (seenIds.has(c.id)) {
      return { ok: false, status: 400, error: "Duplicate custom channel id in request." };
    }
    seenIds.add(c.id);
  }

  const baseById = new Map(base.customChannels.map((c) => [c.id, c]));
  for (const id of baseById.keys()) {
    if (!seenIds.has(id)) {
      return {
        ok: false,
        status: 403,
        error: "Only workspace admins can remove custom channels.",
      };
    }
  }

  const incomingById = new Map(incoming.customChannels.map((c) => [c.id, c]));
  const mergedCustom: OrganizationCustomChannelRow[] = [];
  for (const c of base.customChannels) {
    const next = incomingById.get(c.id);
    if (next) mergedCustom.push(next);
  }
  for (const c of incoming.customChannels) {
    if (!baseById.has(c.id)) mergedCustom.push(c);
  }

  if (mergedCustom.length > 50) {
    return { ok: false, status: 400, error: "Too many custom channels (max 50)." };
  }

  return {
    ok: true,
    merged: {
      autoMap: base.autoMap,
      descriptionOverrides: base.descriptionOverrides,
      customChannels: mergedCustom,
    },
  };
}

export async function GET() {
  const g = await guardTenantApi({ minRole: "member" });
  if (!g.ok) return g.response;

  const org = await getOrganizationServer(g.ctx.session.organizationId);
  if (!org) {
    return NextResponse.json({ error: "Organization not found" }, { status: 404 });
  }

  return NextResponse.json({
    channelAdmin: org.channelAdmin ?? null,
  });
}

export async function PUT(req: Request) {
  const g = await guardTenantApi({ minRole: "member" });
  if (!g.ok) return g.response;

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = putSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const orgId = g.ctx.session.organizationId;
  const org = await getOrganizationServer(orgId);
  if (!org) {
    return NextResponse.json({ error: "Organization not found" }, { status: 404 });
  }

  const incoming = sanitizeChannelAdminInput(parsed.data);
  const base = mergeChannelAdminConfig(org.channelAdmin);

  const channelAdminGuard = await guardAdminFeature("channels");

  let normalized: OrganizationChannelAdminConfig;
  if (channelAdminGuard.ok) {
    normalized = incoming;
  } else {
    const m = mergeMemberChannelAdminPut(base, incoming);
    if (!m.ok) {
      return NextResponse.json({ error: m.error }, { status: m.status });
    }
    normalized = m.merged;
  }

  const result = await updateOrganizationChannelAdminServer(orgId, normalized);
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  await recordAudit({
    organizationId: orgId,
    actorUid: g.ctx.session.uid,
    event: "channel_admin.updated",
    meta: {
      customChannelCount: normalized.customChannels.length,
    },
  });

  return NextResponse.json({ ok: true });
}
