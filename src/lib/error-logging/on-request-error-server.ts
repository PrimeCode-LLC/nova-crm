/**
 * Next.js `onRequestError` → the workspace error log (Admin → Error logs).
 * Unhandled server errors used to be visible only in container logs (QA 2.8 / ROB-08).
 * Never throws: observability must not affect the request.
 */

import { getVerifiedSession } from "@/lib/auth/server";
import { recordErrorLog } from "@/lib/error-logging/record-error-server";

export type RequestErrorInfo = {
  path: string;
  method: string;
  headers?: Record<string, string | string[] | undefined>;
};

type ErrorActor = { organizationId?: string; uid?: string; email?: string };

/**
 * The request's auth context is gone by the time onRequestError runs, but the
 * Clerk middleware forwards the session JWT; verify it and resolve the
 * workspace the same way sign-in does. Unverifiable tokens are ignored.
 */
async function actorFromClerkHeader(
  headers: RequestErrorInfo["headers"],
): Promise<ErrorActor> {
  const raw = headers?.["x-clerk-auth-token"];
  const token = Array.isArray(raw) ? raw[0] : raw;
  const secretKey = process.env.CLERK_SECRET_KEY?.trim();
  if (!token || !secretKey) return {};
  const { verifyToken, createClerkClient } = await import("@clerk/nextjs/server");
  const claims = await verifyToken(token, { secretKey });
  if (!claims?.sub) return {};
  const user = await createClerkClient({ secretKey }).users.getUser(claims.sub);
  const { resolveClerkIdentity } = await import("@/lib/auth/clerk-identity");
  const identity = await resolveClerkIdentity(user);
  return { organizationId: identity.organizationId, uid: identity.uid, email: identity.email };
}
export type RequestErrorContext = { routePath?: string; routeType?: string };

export async function reportRequestErrorServer(
  error: unknown,
  request: RequestErrorInfo,
  context: RequestErrorContext,
): Promise<void> {
  try {
    let actor: ErrorActor = {};
    try {
      const session = await getVerifiedSession();
      if (session?.organizationId) {
        actor = { organizationId: session.organizationId, uid: session.uid, email: session.email ?? undefined };
      }
    } catch {
      /* no request context here — fall back to the forwarded Clerk token */
    }
    if (!actor.organizationId) {
      actor = await actorFromClerkHeader(request.headers).catch(() => ({}));
    }
    const organizationId = actor.organizationId?.trim() || undefined;
    const actorUid = actor.uid;
    const actorEmail = actor.email;
    if (!organizationId) {
      console.error("[onRequestError]", request.method, request.path, error);
      return;
    }
    await recordErrorLog({
      organizationId,
      message: error instanceof Error ? error.message : String(error),
      source: "server",
      error,
      actorUid,
      actorEmail,
      url: request.path,
      route: context.routePath ?? request.path,
      // Stack frames point into Next internals here; the route file is more useful.
      location: context.routePath ? `src/app${context.routePath}` : undefined,
      functionName: `${request.method} ${context.routeType ?? "request"}`,
      httpStatus: 500,
    });
  } catch (err) {
    console.error("[onRequestError] could not record", err);
  }
}
