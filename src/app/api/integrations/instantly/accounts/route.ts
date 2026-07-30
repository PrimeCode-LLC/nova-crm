import { NextResponse } from "next/server";
import { guardInstantlyOutreachApi } from "@/lib/integrations/instantly/guard";
import { listInstantlyAccounts } from "@/lib/integrations/instantly/client";
import { instantlyErrorResponse } from "@/lib/integrations/instantly/api-error";

export async function GET() {
  const g = await guardInstantlyOutreachApi();
  if (!g.ok) return g.response;

  try {
    const accounts = await listInstantlyAccounts(g.apiKey);
    return NextResponse.json({ accounts });
  } catch (err) {
    return instantlyErrorResponse(err, {
      organizationId: g.organizationId,
      actorUid: g.uid,
      location: "src/app/api/integrations/instantly/accounts/route.ts",
      functionName: "handler",
      route: "/api/integrations/instantly/accounts",
    });
  }
}
