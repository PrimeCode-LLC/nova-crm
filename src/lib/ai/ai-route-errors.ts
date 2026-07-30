import { NextResponse } from "next/server";
import { AiForbiddenError, AiNotConfiguredError } from "@/lib/ai/run-feature";
import { parseAiProviderError } from "@/lib/ai/parse-provider-error";
import { recordErrorLog } from "@/lib/error-logging/record-error-server";
import { messageFromUnknown } from "@/lib/error-logging/parse-stack";

export type AiErrorLogContext = {
  organizationId?: string | null;
  actorUid?: string | null;
  actorEmail?: string | null;
  location?: string;
  functionName?: string;
  route?: string;
};

function queueServerErrorLog(
  e: unknown,
  message: string,
  httpStatus: number,
  ctx?: AiErrorLogContext,
) {
  if (!ctx?.organizationId) {
    console.error("[ai]", message, e);
    return;
  }
  void recordErrorLog({
    organizationId: ctx.organizationId,
    message,
    source: "server",
    error: e,
    location: ctx.location ?? "src/lib/ai/ai-route-errors.ts",
    functionName: ctx.functionName ?? "aiErrorResponse",
    actorUid: ctx.actorUid,
    actorEmail: ctx.actorEmail,
    route: ctx.route,
    httpStatus,
  });
}

export function aiErrorResponse(e: unknown, ctx?: AiErrorLogContext): NextResponse {
  if (e instanceof AiForbiddenError) {
    queueServerErrorLog(e, e.message, 403, ctx);
    return NextResponse.json({ error: e.message, code: "forbidden" }, { status: 403 });
  }
  if (e instanceof AiNotConfiguredError) {
    queueServerErrorLog(e, e.message, 503, ctx);
    return NextResponse.json({ error: e.message, code: "not_configured" }, { status: 503 });
  }
  if (e instanceof Error && e.message.includes("API key")) {
    queueServerErrorLog(e, e.message, 503, ctx);
    return NextResponse.json({ error: e.message, code: "not_configured" }, { status: 503 });
  }

  const provider = parseAiProviderError(e);
  if (provider) {
    if (provider.code !== "provider_rate_limit") {
      console.error("[ai]", provider.code, e);
      queueServerErrorLog(e, provider.message, provider.httpStatus, ctx);
    }
    return NextResponse.json(
      { error: provider.message, code: provider.code },
      { status: provider.httpStatus },
    );
  }

  console.error("[ai]", e);
  const message = "AI request failed";
  queueServerErrorLog(e, messageFromUnknown(e, message), 500, ctx);
  return NextResponse.json({ error: message, code: "unknown" }, { status: 500 });
}
