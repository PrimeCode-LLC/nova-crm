import { NextResponse } from "next/server";
import { guardInstantlyApi } from "@/lib/integrations/instantly/guard";
import { listInstantlyAccounts } from "@/lib/integrations/instantly/client";
import { instantlyErrorResponse } from "@/lib/integrations/instantly/api-error";

export async function GET() {
  const g = await guardInstantlyApi({ minRole: "member" });
  if (!g.ok) return g.response;

  try {
    const accounts = await listInstantlyAccounts(g.apiKey);
    return NextResponse.json({ accounts });
  } catch (err) {
    return instantlyErrorResponse(err);
  }
}
