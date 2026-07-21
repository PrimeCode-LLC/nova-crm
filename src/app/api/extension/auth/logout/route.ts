import {
  extensionOptionsResponse,
  guardExtensionApi,
  revokeExtensionSession,
} from "@/lib/extension/auth-server";
import { recordAudit } from "@/lib/firestore/audit";

export function OPTIONS(req: Request) {
  return extensionOptionsResponse(req);
}

export async function POST(req: Request) {
  const guarded = await guardExtensionApi(req);
  if (!guarded.ok) return guarded.response;
  await revokeExtensionSession(guarded.principal.sessionId);
  void recordAudit({
    organizationId: guarded.principal.organizationId,
    actorUid: guarded.principal.uid,
    actorEmail: guarded.principal.email,
    event: "extension.auth_logout",
  });
  return Response.json({ ok: true }, { headers: guarded.headers });
}
