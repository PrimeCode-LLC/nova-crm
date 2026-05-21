import { NextResponse } from "next/server";
import { z } from "zod";
import { guardTenantApi } from "@/lib/platform/tenant-api-guard";
import { aiErrorResponse } from "@/lib/ai/ai-route-errors";
import { runAiTextFeature } from "@/lib/ai/run-feature";
import { canUseAiFeature, getOrganizationAiSettingsServer } from "@/lib/ai/ai-settings-server";
import { buildRagInstructionBlock } from "@/lib/ai/prompt-defaults";
import { retrieveRagChunksServer } from "@/lib/ai/rag-retrieve";
import { getAdminDb } from "@/lib/firebase/admin";
import { COLLECTIONS } from "@/lib/firestore/collections";
import type { Lead, Role } from "@/lib/types";

const bodySchema = z.object({
  thread: z.string().min(1).max(50_000),
  leadContext: z.string().max(20_000).optional(),
  leadId: z.string().optional(),
  channel: z.string().optional(),
  profileId: z.string().optional(),
  campaignId: z.string().optional(),
  tone: z.enum(["professional", "friendly", "concise"]).default("professional"),
  goal: z.string().max(200).default("follow up"),
});

export async function POST(req: Request) {
  const g = await guardTenantApi();
  if (!g.ok) return g.response;

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const orgId = g.ctx.session.organizationId;
  const uid = g.ctx.session.uid;
  const userSnap = await getAdminDb()?.collection(COLLECTIONS.users).doc(uid).get();
  const roleId = (userSnap?.data()?.roleId ?? "salesperson") as Role;

  const settings = await getOrganizationAiSettingsServer(orgId);
  if (!canUseAiFeature(settings, "email_reply", roleId)) {
    return NextResponse.json({ error: "AI email reply is not enabled for your role." }, { status: 403 });
  }

  const feat = settings.features.email_reply;
  const chunks = await retrieveRagChunksServer({
    organizationId: orgId,
    query: parsed.data.thread.slice(0, 500),
    libraryIds: feat.libraryIds,
    scope: {
      channel: parsed.data.channel,
      profileId: parsed.data.profileId,
      campaignId: parsed.data.campaignId,
    },
    topK: 6,
  });
  const ragBlock = buildRagInstructionBlock(
    feat.ragMode ?? "reference",
    chunks.map((c) => ({ title: c.title, content: c.content })),
  );

  try {
    const body = await runAiTextFeature({
      organizationId: orgId,
      userId: uid,
      userDisplayName: g.ctx.session.name,
      roleId,
      feature: "email_reply",
      promptVars: {
        tone: parsed.data.tone,
        goal: parsed.data.goal,
        thread: parsed.data.thread,
        leadContext: parsed.data.leadContext ?? "(no lead linked)",
        ragBlock: ragBlock || "(none)",
      },
      leadId: parsed.data.leadId,
    });
    return NextResponse.json({ body });
  } catch (e) {
    return aiErrorResponse(e);
  }
}
