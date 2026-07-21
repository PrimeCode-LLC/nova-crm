import {
  extensionOptionsResponse,
  guardExtensionApi,
} from "@/lib/extension/auth-server";

export function OPTIONS(req: Request) {
  return extensionOptionsResponse(req);
}

export async function GET(req: Request) {
  const guarded = await guardExtensionApi(req);
  if (!guarded.ok) return guarded.response;
  return Response.json(
    {
      ok: true,
      leaseExpiresAt: guarded.leaseExpiresAt,
      sessionExpiresAt: guarded.principal.expiresAt,
      user: {
        id: guarded.principal.uid,
        email: guarded.principal.email,
        name: guarded.principal.name,
      },
    },
    { headers: guarded.headers },
  );
}
