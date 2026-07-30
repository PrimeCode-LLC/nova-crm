import { NextResponse } from "next/server";
import { InstantlyApiError } from "./client";
import { recordErrorLog } from "@/lib/error-logging/record-error-server";
import { messageFromUnknown } from "@/lib/error-logging/parse-stack";

export type InstantlyErrorLogContext = {
  organizationId?: string | null;
  actorUid?: string | null;
  actorEmail?: string | null;
  location?: string;
  functionName?: string;
  route?: string;
};

function queueLog(
  err: unknown,
  message: string,
  httpStatus: number,
  ctx?: InstantlyErrorLogContext,
) {
  if (!ctx?.organizationId) {
    console.error("[instantly]", message, err);
    return;
  }
  void recordErrorLog({
    organizationId: ctx.organizationId,
    message,
    source: "server",
    error: err,
    location: ctx.location ?? "src/lib/integrations/instantly/api-error.ts",
    functionName: ctx.functionName ?? "instantlyErrorResponse",
    actorUid: ctx.actorUid,
    actorEmail: ctx.actorEmail,
    route: ctx.route,
    httpStatus,
  });
}

export function instantlyErrorResponse(
  err: unknown,
  ctx?: InstantlyErrorLogContext,
): NextResponse {
  if (err instanceof InstantlyApiError) {
    const status = err.status >= 400 ? err.status : 502;
    queueLog(err, err.message, status, ctx);
    return NextResponse.json({ error: err.message }, { status });
  }
  if (err instanceof Error) {
    queueLog(err, err.message, 500, ctx);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
  const message = messageFromUnknown(err, "Unknown error");
  queueLog(err, message, 500, ctx);
  return NextResponse.json({ error: message }, { status: 500 });
}
