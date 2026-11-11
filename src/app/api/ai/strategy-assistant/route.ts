import { NextResponse } from "next/server";
import { z } from "zod";
import { guardAdminFeature } from "@/lib/platform/guard-admin-feature";
import { aiErrorResponse } from "@/lib/ai/ai-route-errors";
import { runAiStructuredFeature } from "@/lib/ai/run-feature";
import {
  aiFeatureDenialMessage,
  canUseAiFeature,
  getOrganizationAiSettingsServer,
} from "@/lib/ai/ai-settings-server";
import {
  applyStrategyFields,
  blankStrategy,
  formatAssistantContext,
  mergeMissingFields,
  missingSegments,
  strategyAssistantOutputSchema,
  strategyFillOutputSchema,
  validateProposal,
  type AssistantContext,
  type StrategyAssistantOutput,
} from "@/lib/prospecting-strategy/assistant";
import { AI_PROMPT_DEFAULTS } from "@/lib/ai/prompt-defaults";
import {
  appendStrategyAssistantMessages,
  isValidThreadKey,
  loadStrategyAssistantThread,
  setStrategyAssistantProposalStatus,
  type StrategyAssistantMessage,
} from "@/lib/prospecting-strategy/assistant-threads-server";
import type { ProspectingStrategy, StrategyAssignment } from "@/lib/prospecting-strategy/types";

const FEATURE = "strategy_assistant" as const;
const ROUTE = "/api/ai/strategy-assistant";
/** Turns of history sent back to the model. */
const HISTORY_TURNS = 20;

const threadKeySchema = z.string().refine(isValidThreadKey, "Invalid thread");

// The client sends what the Strategies page already has loaded; the model's
// answer is only a proposal, and applying it goes through the normal writers.
const postSchema = z.object({
  threadKey: threadKeySchema,
  message: z.string().trim().min(1).max(8000),
  /** Starts a new topic: earlier messages stay visible but are no longer sent to the model. */
  newTopic: z.boolean().optional(),
  context: z.object({
    focusStrategyId: z.string().max(160).nullable(),
    strategies: z.array(z.record(z.string(), z.unknown())).max(300),
    assignments: z.array(z.record(z.string(), z.unknown())).max(3000),
    personas: z
      .array(z.object({ id: z.string(), name: z.string(), titles: z.array(z.string()).max(50) }))
      .max(300),
    signals: z
      .array(z.object({ id: z.string(), label: z.string(), category: z.string() }))
      .max(300),
    users: z.array(z.object({ id: z.string(), name: z.string() })).max(1000),
  }),
});

const patchSchema = z.object({
  threadKey: threadKeySchema,
  messageId: z.string().min(1).max(100),
  status: z.enum(["applied", "discarded"]),
  appliedStrategyId: z.string().max(160).optional(),
});

function fillPrompt(input: {
  contextBlock: string;
  conversation: string;
  message: string;
  draft: unknown;
  missing: string[];
}): string {
  return `Workspace data:
${input.contextBlock}

Conversation so far:
${input.conversation || "(first message)"}

Manager's latest message:
${input.message}

Your draft of the strategy fields so far:
${JSON.stringify(input.draft)}

These parts of the strategy are still EMPTY:
- ${input.missing.join("\n- ")}

Return "fields" with a specific, useful value for EVERY empty part listed above, derived from the manager's request and the workspace data (search templates = Google / LinkedIn queries a researcher can run; daily targets = realistic non-zero numbers where "completed" equals the default daily target; industry mix = targets per industry that add up to the daily target; send window = business hours, in the workspace timezone). Set every other field to null. Use null for a listed part only if it truly cannot be inferred.`;
}

function newMessageId(): string {
  return crypto.randomUUID();
}

function describeForHistory(m: StrategyAssistantMessage): string {
  if (m.role === "user") return `Manager: ${m.content}`;
  const parts = [`Assistant: ${m.content}`];
  if (m.questions?.length) parts.push(`(asked: ${m.questions.join(" | ")})`);
  if (m.proposal) {
    parts.push(`(proposed: ${m.proposal.summary}; status: ${m.proposalStatus ?? "pending"})`);
  }
  return parts.join(" ");
}

export async function GET(req: Request) {
  const g = await guardAdminFeature("prospecting_strategies");
  if (!g.ok) return g.response;
  const threadKey = new URL(req.url).searchParams.get("thread") ?? "";
  if (!isValidThreadKey(threadKey)) {
    return NextResponse.json({ error: "Invalid thread" }, { status: 400 });
  }
  const messages = await loadStrategyAssistantThread(g.ctx.session.organizationId, threadKey);
  return NextResponse.json({ messages });
}

export async function POST(req: Request) {
  const g = await guardAdminFeature("prospecting_strategies");
  if (!g.ok) return g.response;
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

  const settings = await getOrganizationAiSettingsServer(orgId);
  if (!canUseAiFeature(settings, FEATURE, g.actor.roleId)) {
    return NextResponse.json(
      {
        error: aiFeatureDenialMessage(
          settings,
          FEATURE,
          "The strategy assistant is not enabled for your role.",
        ),
      },
      { status: 403 },
    );
  }

  const { threadKey, message } = parsed.data;
  const ctx: AssistantContext = {
    ...parsed.data.context,
    strategies: parsed.data.context.strategies as unknown as ProspectingStrategy[],
    assignments: parsed.data.context.assignments as unknown as StrategyAssignment[],
  };

  const prior = parsed.data.newTopic ? [] : await loadStrategyAssistantThread(orgId, threadKey);
  const lastTopic = prior.findLastIndex((m) => m.topicStart);
  const conversation = prior
    .slice(lastTopic >= 0 ? lastTopic : 0)
    .slice(-HISTORY_TURNS)
    .map(describeForHistory)
    .join("\n\n");

  let output;
  try {
    ({ output } = await runAiStructuredFeature({
      organizationId: orgId,
      userId: uid,
      userDisplayName: g.ctx.session.name,
      roleId: g.actor.roleId,
      feature: FEATURE,
      schema: strategyAssistantOutputSchema,
      promptVars: {
        context: formatAssistantContext(ctx),
        conversation: conversation || "(first message)",
        userMessage: message,
      },
    }));
  } catch (e) {
    return aiErrorResponse(e, {
      organizationId: orgId,
      actorUid: uid,
      actorEmail: g.ctx.session.email,
      location: "src/app/api/ai/strategy-assistant/route.ts",
      functionName: "POST",
      route: ROUTE,
    });
  }

  const now = new Date().toISOString();
  const contextBlock = formatAssistantContext(ctx);
  let raw: StrategyAssistantOutput["proposal"] = output.proposal;
  let { proposal, warnings } = validateProposal(raw, ctx);
  const questions = output.questions.filter((q) => q.trim());

  // Creating or completing a strategy: every segment must be covered. Ask the
  // model once more for whatever it left empty, then ask the manager about the rest.
  if (raw && proposal && raw.fillEverything) {
    const base =
      proposal.action === "create"
        ? blankStrategy({ id: "draft", organizationId: orgId, userId: uid, now })
        : ctx.strategies.find((s) => s.id === proposal!.strategyId);
    if (base) {
      const missing = missingSegments(applyStrategyFields(base, proposal.fields, null, uid, now), ctx);
      if (missing.length) {
        try {
          const fill = await runAiStructuredFeature({
            organizationId: orgId,
            userId: uid,
            userDisplayName: g.ctx.session.name,
            roleId: g.actor.roleId,
            feature: FEATURE,
            schema: strategyFillOutputSchema,
            promptVars: {},
            systemPromptOverride: AI_PROMPT_DEFAULTS.strategy_assistant.systemPrompt,
            userPromptOverride: fillPrompt({
              contextBlock,
              conversation,
              message,
              draft: proposal.fields,
              missing: missing.map((m) => `${m.label} (${m.keys.join(", ")})`),
            }),
          });
          raw = {
            ...raw,
            fields: mergeMissingFields(raw.fields, fill.output.fields, missing.flatMap((m) => m.keys)),
          };
          ({ proposal, warnings } = validateProposal(raw, ctx));
        } catch (e) {
          // The first answer is still usable; just report what stays empty.
          console.warn("[strategy-assistant] fill pass failed", e);
        }
      }
      const still = proposal ? missingSegments(applyStrategyFields(base, proposal.fields, null, uid, now), ctx) : [];
      if (still.length) {
        questions.push(
          `These parts are still empty: ${still.map((m) => m.label).join(", ")}. Tell me what to use, or say "leave them".`,
        );
      }
    }
  }

  const userMsg: StrategyAssistantMessage = {
    id: newMessageId(),
    role: "user",
    content: message,
    userId: uid,
    userName: g.actor.displayName,
    createdAt: now,
    ...(parsed.data.newTopic ? { topicStart: true } : {}),
  };
  const assistantMsg: StrategyAssistantMessage = {
    id: newMessageId(),
    role: "assistant",
    content: output.reply,
    userId: uid,
    createdAt: now,
    questions,
    warnings,
    proposal,
    ...(proposal ? { proposalStatus: "pending" as const } : {}),
  };
  await appendStrategyAssistantMessages(orgId, threadKey, [userMsg, assistantMsg]);
  return NextResponse.json({ messages: [userMsg, assistantMsg] });
}

/** Records that the manager applied or discarded a proposal. */
export async function PATCH(req: Request) {
  const g = await guardAdminFeature("prospecting_strategies");
  if (!g.ok) return g.response;
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = patchSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const ok = await setStrategyAssistantProposalStatus({
    organizationId: g.ctx.session.organizationId,
    resolvedBy: g.ctx.session.uid,
    ...parsed.data,
  });
  if (!ok) {
    return NextResponse.json({ error: "This change was already handled." }, { status: 409 });
  }
  return NextResponse.json({ ok: true });
}
