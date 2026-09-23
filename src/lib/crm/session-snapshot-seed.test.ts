import { afterEach, describe, expect, it } from "vitest";

import { rememberCrmEntities } from "@/lib/crm/entity-cache";
import { withCachedSessionTargets } from "@/lib/crm/session-snapshot-seed";
import type { Lead } from "@/lib/types";
import type { WorkspaceSnapshot } from "@/lib/workspace-dataset-core";
import { emptyWorkspaceSession } from "@/lib/workspace-session";

const emptyBase = {
  leads: [],
  accounts: [],
  contacts: [],
} as unknown as WorkspaceSnapshot;

describe("withCachedSessionTargets", () => {
  const prev = process.env.WORKSPACE_CRM_SNAPSHOT_OFF;
  const prevPublic = process.env.NEXT_PUBLIC_WORKSPACE_CRM_SNAPSHOT_OFF;

  afterEach(() => {
    if (prev === undefined) delete process.env.WORKSPACE_CRM_SNAPSHOT_OFF;
    else process.env.WORKSPACE_CRM_SNAPSHOT_OFF = prev;
    if (prevPublic === undefined) delete process.env.NEXT_PUBLIC_WORKSPACE_CRM_SNAPSHOT_OFF;
    else process.env.NEXT_PUBLIC_WORKSPACE_CRM_SNAPSHOT_OFF = prevPublic;
  });

  it("leaves the snapshot unchanged when the flag is off", () => {
    delete process.env.WORKSPACE_CRM_SNAPSHOT_OFF;
    delete process.env.NEXT_PUBLIC_WORKSPACE_CRM_SNAPSHOT_OFF;
    const session = emptyWorkspaceSession();
    session.leadPatches["lead-1"] = { stage: "qualified" };
    rememberCrmEntities("leads", [{ id: "lead-1", companyName: "Acme" } as Lead]);
    expect(withCachedSessionTargets(emptyBase, session)).toBe(emptyBase);
  });

  it("seeds a cached lead so an empty snapshot can still apply a session patch", () => {
    process.env.WORKSPACE_CRM_SNAPSHOT_OFF = "true";
    const session = emptyWorkspaceSession();
    session.leadPatches["lead-cache-seed"] = { stage: "qualified" };
    rememberCrmEntities("leads", [{ id: "lead-cache-seed", companyName: "Cached" } as Lead]);
    const next = withCachedSessionTargets(emptyBase, session);
    expect(next.leads.map((lead) => lead.id)).toEqual(["lead-cache-seed"]);
  });
});
