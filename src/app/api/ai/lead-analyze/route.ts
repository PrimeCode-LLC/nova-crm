import { NextResponse } from "next/server";
import { z } from "zod";
import { guardTenantApi } from "@/lib/platform/tenant-api-guard";
import { aiErrorResponse } from "@/lib/ai/ai-route-errors";
import { buildLeadAiContext } from "@/lib/ai/context/lead-context";
import { runAiStructuredFeature } from "@/lib/ai/run-feature";
import { canUseAiFeature, getOrganizationAiSettingsServer } from "@/lib/ai/ai-settings-server";
import { buildRagInstructionBlock } from "@/lib/ai/prompt-defaults";
import { retrieveRagChunksServer } from "@/lib/ai/rag-retrieve";
import { getAdminDb } from "@/lib/firebase/admin";
import { COLLECTIONS } from "@/lib/firestore/collections";
import type { Lead, Role } from "@/lib/types";

const analysisSchema = z.object({
  summary: z.string(),
  wins: z.array(z.string()),
  issues: z.array(z.string()),
  improvements: z.array(z.string()),
  riskLevel: z.enum(["low", "medium", "high"]),
  nextActions: z.array(z.string()),
});

const bodySchema = z.object({
  leadId: z.string().min(1),
  demoContext: z
    .object({
      lead: z.record(z.string(), z.unknown()),
      account: z.record(z.string(), z.unknown()).optional(),
      contact: z.record(z.string(), z.unknown()).optional(),
      deal: z.record(z.string(), z.unknown()).optional(),
      notes: z.array(z.record(z.string(), z.unknown())).optional(),
      timeline: z.array(z.record(z.string(), z.unknown())).optional(),
      touchpoints: z.array(z.record(z.string(), z.unknown())).optional(),
      followups: z.array(z.record(z.string(), z.unknown())).optional(),
      tasks: z.array(z.record(z.string(), z.unknown())).optional(),
      emailThreads: z
        .array(
          z.object({
            subject: z.string(),
            messages: z.array(
              z.object({ from: z.string(), date: z.string(), snippet: z.string() }),
            ),
          }),
        )
        .optional(),
    })
    .optional(),
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
  const db = getAdminDb();

  const userSnap = await db?.collection(COLLECTIONS.users).doc(uid).get();
  const roleId = (userSnap?.data()?.roleId ?? "salesperson") as Role;

  const settings = await getOrganizationAiSettingsServer(orgId);
  if (!canUseAiFeature(settings, "lead_analyze", roleId)) {
    return NextResponse.json({ error: "Lead analysis is not enabled for your role." }, { status: 403 });
  }

  let ctxInput: Parameters<typeof buildLeadAiContext>[0];

  if (parsed.data.demoContext) {
    const d = parsed.data.demoContext;
    ctxInput = {
      lead: d.lead as unknown as Lead,
      account: d.account as unknown as import("@/lib/types").Account | undefined,
      contact: d.contact as unknown as import("@/lib/types").Contact | undefined,
      deal: d.deal as unknown as import("@/lib/types").Deal | undefined,
      notes: (d.notes ?? []) as unknown as import("@/lib/types").Note[],
      timeline: (d.timeline ?? []) as unknown as import("@/lib/types").TimelineEvent[],
      touchpoints: (d.touchpoints ?? []) as unknown as import("@/lib/types").Touchpoint[],
      followups: (d.followups ?? []) as unknown as import("@/lib/types").Followup[],
      tasks: (d.tasks ?? []) as unknown as import("@/lib/types").LeadTask[],
      emailThreads: d.emailThreads,
    };
  } else {
    if (!db) return NextResponse.json({ error: "Database not configured" }, { status: 503 });
    const leadSnap = await db.collection(COLLECTIONS.leads).doc(parsed.data.leadId).get();
    if (!leadSnap.exists) {
      return NextResponse.json({ error: "Lead not found" }, { status: 404 });
    }
    const rawLead = leadSnap.data() as Record<string, unknown>;
    if (rawLead.organizationId !== orgId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const lead = { ...rawLead, id: leadSnap.id } as Lead;

    const [accountSnap, contactSnap, notesSnap, timelineSnap, touchSnap, followSnap, tasksSnap] =
      await Promise.all([
        db.collection(COLLECTIONS.accounts).doc(lead.accountId).get(),
        db.collection(COLLECTIONS.contacts).doc(lead.contactId).get(),
        db
          .collection(COLLECTIONS.notes)
          .where("leadId", "==", lead.id)
          .limit(30)
          .get(),
        db
          .collection(COLLECTIONS.timelineEvents)
          .where("leadId", "==", lead.id)
          .limit(40)
          .get(),
        db
          .collection(COLLECTIONS.touchpoints)
          .where("leadId", "==", lead.id)
          .limit(30)
          .get(),
        db
          .collection(COLLECTIONS.followups)
          .where("leadId", "==", lead.id)
          .limit(20)
          .get(),
        db
          .collection(COLLECTIONS.leadTasks)
          .where("leadId", "==", lead.id)
          .limit(20)
          .get(),
      ]);

    let deal: import("@/lib/types").Deal | undefined;
    const dealsSnap = await db
      .collection(COLLECTIONS.deals)
      .where("leadId", "==", lead.id)
      .limit(1)
      .get();
    if (!dealsSnap.empty) {
      deal = { ...dealsSnap.docs[0].data(), id: dealsSnap.docs[0].id } as import("@/lib/types").Deal;
    }

    ctxInput = {
      lead,
      account: accountSnap.exists
        ? ({ ...accountSnap.data(), id: accountSnap.id } as import("@/lib/types").Account)
        : undefined,
      contact: contactSnap.exists
        ? ({ ...contactSnap.data(), id: contactSnap.id } as import("@/lib/types").Contact)
        : undefined,
      deal,
      notes: notesSnap.docs.map((d) => ({ ...d.data(), id: d.id }) as import("@/lib/types").Note),
      timeline: timelineSnap.docs.map(
        (d) => ({ ...d.data(), id: d.id }) as import("@/lib/types").TimelineEvent,
      ),
      touchpoints: touchSnap.docs.map(
        (d) => ({ ...d.data(), id: d.id }) as import("@/lib/types").Touchpoint,
      ),
      followups: followSnap.docs.map(
        (d) => ({ ...d.data(), id: d.id }) as import("@/lib/types").Followup,
      ),
      tasks: tasksSnap.docs.map(
        (d) => ({ ...d.data(), id: d.id }) as import("@/lib/types").LeadTask,
      ),
      emailThreads: [],
    };
  }

  const context = buildLeadAiContext(ctxInput);
  const feat = settings.features.lead_analyze;
  const ragMode = feat.ragMode ?? "reference";
  const chunks = await retrieveRagChunksServer({
    organizationId: orgId,
    query: `${ctxInput.lead.stage} ${ctxInput.lead.channel} ${ctxInput.lead.painPoints ?? ""}`,
    libraryIds: feat.libraryIds,
    scope: {
      channel: ctxInput.lead.channel,
      profileId: ctxInput.lead.profileId,
      campaignId: ctxInput.lead.campaignId,
    },
    topK: 6,
  });
  const ragBlock = buildRagInstructionBlock(
    ragMode,
    chunks.map((c) => ({ title: c.title, content: c.content })),
  );

  try {
    const result = await runAiStructuredFeature({
      organizationId: orgId,
      userId: uid,
      userDisplayName: g.ctx.session.name,
      roleId,
      feature: "lead_analyze",
      promptVars: {
        context,
        ragBlock: ragBlock || "(none)",
      },
      schema: analysisSchema,
      leadId: parsed.data.leadId,
    });
    return NextResponse.json(result);
  } catch (e) {
    return aiErrorResponse(e);
  }
}
