import { z } from "zod";
import {
  exchangeExtensionAuthorizationCode,
  extensionCorsHeaders,
  extensionOptionsResponse,
} from "@/lib/extension/auth-server";
import { recordAudit } from "@/lib/documents/audit";

const bodySchema = z.object({
  code: z.string().min(32).max(256),
  codeVerifier: z.string().min(43).max(128),
  redirectUri: z.string().url().max(500),
});

export function OPTIONS(req: Request) {
  return extensionOptionsResponse(req);
}

export async function POST(req: Request) {
  const origin = req.headers.get("origin");
  const headers = extensionCorsHeaders(origin);
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON." }, { status: 400, headers });
  }
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.flatten() }, { status: 400, headers });
  }

  const result = await exchangeExtensionAuthorizationCode({
    ...parsed.data,
    origin,
    extensionIdHeader: req.headers.get("x-nova-extension-id"),
  });
  if (!result.ok) {
    return Response.json({ error: result.error }, { status: result.status, headers });
  }
  void recordAudit({
    organizationId: result.principal.organizationId,
    actorUid: result.principal.uid,
    actorEmail: result.principal.email,
    event: "extension.auth_login",
    meta: { expiresAt: result.expiresAt },
  });
  return Response.json(result, { headers });
}
