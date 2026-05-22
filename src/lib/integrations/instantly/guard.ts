import { NextResponse } from "next/server";
import { guardTenantApi } from "@/lib/platform/tenant-api-guard";
import type { OrgMemberRole } from "@/lib/types";
import { getInstantlyApiKeyServer, hasInstantlyApiKeyServer } from "./secrets";

export async function guardInstantlyApi(opts?: {
  minRole?: OrgMemberRole;
}): Promise<
  | { ok: true; organizationId: string; uid: string; apiKey: string }
  | { ok: false; response: NextResponse }
> {
  const g = await guardTenantApi(opts);
  if (!g.ok) return { ok: false, response: g.response };
  const connected = await hasInstantlyApiKeyServer(g.ctx.session.organizationId);
  if (!connected) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Instantly is not connected. Add your API key in Settings → Integrations." },
        { status: 400 },
      ),
    };
  }
  const apiKey = await getInstantlyApiKeyServer(g.ctx.session.organizationId);
  if (!apiKey) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Instantly API key unavailable" }, { status: 503 }),
    };
  }
  return {
    ok: true,
    organizationId: g.ctx.session.organizationId,
    uid: g.ctx.session.uid,
    apiKey,
  };
}
