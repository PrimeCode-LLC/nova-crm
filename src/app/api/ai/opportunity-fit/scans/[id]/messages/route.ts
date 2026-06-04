import { NextResponse } from "next/server";
import { z } from "zod";
import { guardTenantApi } from "@/lib/platform/tenant-api-guard";
import { aiErrorResponse } from "@/lib/ai/ai-route-errors";
import { runAiTextFeature } from "@/lib/ai/run-feature";
import { canUseAiFeature, getOrganizationAiSettingsServer } from "@/lib/ai/ai-settings-server";
import { retrieveFitCheckContextServer } from "@/lib/ai/fit-check-rag";
import { getAdminDb } from "@/lib/firebase/admin";
import { COLLECTIONS } from "@/lib/firestore/collections";
import {
  appendOpportunityScanMessageServer,
  formatScanForDiscussPrompt,
  getOpportunityScanServer,
  listOpportunityScanMessagesServer,
  viewerIsElevatedForFitScans,
} from "@/lib/ai/opportunity-fit-server";
import { isAuthDisabled } from "@/lib/auth/flags";
import type { Role } from "@/lib/types";

const postSchema = z.object({
  message: z.string().min(1).max(8000),
  demo: z.boolean().optional(),
});

type RouteCtx = { params: Promise<{ id: string }> };

async function resolveElevated(uid: string, orgRole: Parameters<typeof viewerIsElevatedForFitScans>[0]["orgRole"]) {
  const db = getAdminDb();
  const userSnap = await db?.collection(COLLECTIONS.users).doc(uid).get();
  const userData = userSnap?.data();
  return viewerIsElevatedForFitScans({
    orgRole,
    roleId: userData?.roleId as Role | undefined,
    isSuperAdmin: userData?.isSuperAdmin === true,
  });
}

export async function GET(_req: Request, ctx: RouteCtx) {
  const g = await guardTenantApi();
  if (!g.ok) return g.response;

  const { id } = await ctx.params;
  const elevated = await resolveElevated(g.ctx.session.uid, g.ctx.role);

  const messages = await listOpportunityScanMessagesServer({
    organizationId: g.ctx.session.organizationId,
    scanId: id,
    viewerUserId: g.ctx.session.uid,
    elevated,
  });

  return NextResponse.json({ messages });
}

export async function POST(req: Request, ctx: RouteCtx) {
  const g = await guardTenantApi();
  if (!g.ok) return g.response;

  const { id } = await ctx.params;
  const orgId = g.ctx.session.organizationId;
  const uid = g.ctx.session.uid;

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = postSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const db = getAdminDb();
  const userSnap = await db?.collection(COLLECTIONS.users).doc(uid).get();
  const roleId = (userSnap?.data()?.roleId ?? "salesperson") as Role;
  const elevated = await resolveElevated(uid, g.ctx.role);

  const settings = await getOrganizationAiSettingsServer(orgId);
  if (!canUseAiFeature(settings, "opportunity_fit_discuss", roleId)) {
    return NextResponse.json({ error: "Discuss is not enabled for your role." }, { status: 403 });
  }

  const scan = await getOpportunityScanServer({
    organizationId: orgId,
    scanId: id,
    viewerUserId: uid,
    elevated,
  });
  if (!scan) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const prior = await listOpportunityScanMessagesServer({
    organizationId: orgId,
    scanId: id,
    viewerUserId: uid,
    elevated,
  });

  await appendOpportunityScanMessageServer({
    organizationId: orgId,
    scanId: id,
    viewerUserId: uid,
    elevated,
    role: "user",
    content: parsed.data.message,
  });

  const conversation = [...prior, { role: "user" as const, content: parsed.data.message }]
    .map((m) => `${m.role === "user" ? "Rep" : "Assistant"}: ${m.content}`)
    .join("\n\n");

  const baseVars = formatScanForDiscussPrompt(scan);
  const useDemo = parsed.data.demo === true || isAuthDisabled();

  let assistantText: string;
  if (useDemo) {
    assistantText = `**Demo reply** — configure AI keys for live answers.\n\nOn this scan (${scan.result.verdict}, ${scan.result.fitScore}%): ${parsed.data.message}\n\nI'd focus on the first hook (“${scan.result.hooks[0]?.angle ?? "value"}”) and confirm budget before investing more than 20 minutes.`;
  } else {
    const rag = await retrieveFitCheckContextServer({
      organizationId: orgId,
      query: `${scan.title} ${parsed.data.message}`,
      sourceType: scan.sourceType,
      profileId: scan.profileId,
      profileLabel: scan.profileDisplayName,
    });
    const ragBlock = rag.ragBlock;

    try {
      assistantText = await runAiTextFeature({
        organizationId: orgId,
        userId: uid,
        userDisplayName: g.ctx.session.name,
        roleId,
        feature: "opportunity_fit_discuss",
        promptVars: {
          ...baseVars,
          ragBlock: ragBlock || "",
          conversation: conversation || "(first message)",
          userMessage: parsed.data.message,
        },
      });
    } catch (e) {
      return aiErrorResponse(e);
    }
  }

  const saved = await appendOpportunityScanMessageServer({
    organizationId: orgId,
    scanId: id,
    viewerUserId: uid,
    elevated,
    role: "assistant",
    content: assistantText,
  });

  if ("error" in saved) {
    return NextResponse.json({ reply: assistantText, warning: saved.error });
  }

  return NextResponse.json({ reply: assistantText, message: saved.message });
}
