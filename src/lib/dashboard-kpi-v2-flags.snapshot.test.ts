import { afterEach, describe, expect, it } from "vitest";

import {
  inMemoryLeadScanUnavailable,
  isLiveCrmSnapshotDisabled,
  isWorkspaceCrmSnapshotOff,
} from "@/lib/dashboard-kpi-v2-flags";

describe("WORKSPACE_CRM_SNAPSHOT_OFF", () => {
  const prev = process.env.WORKSPACE_CRM_SNAPSHOT_OFF;
  const prevPublic = process.env.NEXT_PUBLIC_WORKSPACE_CRM_SNAPSHOT_OFF;

  afterEach(() => {
    if (prev === undefined) delete process.env.WORKSPACE_CRM_SNAPSHOT_OFF;
    else process.env.WORKSPACE_CRM_SNAPSHOT_OFF = prev;
    if (prevPublic === undefined) delete process.env.NEXT_PUBLIC_WORKSPACE_CRM_SNAPSHOT_OFF;
    else process.env.NEXT_PUBLIC_WORKSPACE_CRM_SNAPSHOT_OFF = prevPublic;
  });

  it("defaults off and stays off for demo even when the env flag is set", () => {
    delete process.env.WORKSPACE_CRM_SNAPSHOT_OFF;
    delete process.env.NEXT_PUBLIC_WORKSPACE_CRM_SNAPSHOT_OFF;
    expect(isWorkspaceCrmSnapshotOff()).toBe(false);
    expect(isLiveCrmSnapshotDisabled(false)).toBe(false);
    expect(isLiveCrmSnapshotDisabled(true)).toBe(false);

    process.env.WORKSPACE_CRM_SNAPSHOT_OFF = "true";
    expect(isWorkspaceCrmSnapshotOff()).toBe(true);
    expect(isLiveCrmSnapshotDisabled(false)).toBe(true);
    expect(isLiveCrmSnapshotDisabled(true)).toBe(false);
    expect(inMemoryLeadScanUnavailable(false, 0)).toBe(true);
    expect(inMemoryLeadScanUnavailable(true, 0)).toBe(false);
    expect(inMemoryLeadScanUnavailable(false, 3)).toBe(false);
  });
});
