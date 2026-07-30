import { NextResponse } from "next/server";
import { recordErrorLog } from "@/lib/error-logging/record-error-server";
import { messageFromUnknown } from "@/lib/error-logging/parse-stack";

export type ApiErrorLogContext = {
  organizationId?: string | null;
  actorUid?: string | null;
  actorEmail?: string | null;
  location: string;
  functionName: string;
  route?: string | null;
  /** Override user-facing message; defaults to Error.message */
  message?: string;
  httpStatus?: number;
  /** Extra JSON fields on the error response body */
  body?: Record<string, unknown>;
};

/**
 * Record a server error and return a JSON `{ error }` response.
 * Logging failures never affect the response.
 */
export async function jsonErrorWithLog(
  error: unknown,
  ctx: ApiErrorLogContext,
): Promise<NextResponse> {
  const status = ctx.httpStatus ?? 500;
  const message =
    ctx.message ?? messageFromUnknown(error, "Request failed");

  if (ctx.organizationId) {
    await recordErrorLog({
      organizationId: ctx.organizationId,
      message,
      source: "server",
      error,
      location: ctx.location,
      functionName: ctx.functionName,
      actorUid: ctx.actorUid,
      actorEmail: ctx.actorEmail,
      route: ctx.route,
      httpStatus: status,
    });
  } else {
    console.error("[api-error]", ctx.location, ctx.functionName, error);
  }

  return NextResponse.json(
    { error: message, ...(ctx.body ?? {}) },
    { status },
  );
}
