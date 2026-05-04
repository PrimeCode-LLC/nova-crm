import { NextResponse } from "next/server";
import { z } from "zod";
import { CHANNELS } from "@/lib/constants";
import type { ChannelKey } from "@/lib/types";
import type { OrganizationChannelAdminConfig } from "@/lib/types";
import { mergeChannelAdminConfig } from "@/lib/channel-admin-defaults";
import { guardTenantApi } from "@/lib/platform/tenant-api-guard";
import { roleAtLeast } from "@/lib/platform/org-role";
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

  if (!roleAtLeast(g.ctx.role, "admin")) {
    return NextResponse.json(
      { error: "Only workspace admins can edit channel settings." },
      { status: 403 },
    );
  }

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
  const normalized = sanitizeChannelAdminInput(parsed.data);

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
