import { afterEach, describe, expect, it } from "vitest";
import {
  DASHBOARD_SUMMARIES_V1_FLAG,
  isDashboardSummariesV1Enabled,
} from "@/lib/dashboard-summary-flags";

describe("dashboard_summaries_v1 flag", () => {
  const prev = {
    server: process.env.DASHBOARD_SUMMARIES_V1,
    public: process.env.NEXT_PUBLIC_DASHBOARD_SUMMARIES_V1,
  };

  afterEach(() => {
    if (prev.server === undefined) delete process.env.DASHBOARD_SUMMARIES_V1;
    else process.env.DASHBOARD_SUMMARIES_V1 = prev.server;
    if (prev.public === undefined) delete process.env.NEXT_PUBLIC_DASHBOARD_SUMMARIES_V1;
    else process.env.NEXT_PUBLIC_DASHBOARD_SUMMARIES_V1 = prev.public;
  });

  it("exposes the canonical flag id", () => {
    expect(DASHBOARD_SUMMARIES_V1_FLAG).toBe("dashboard_summaries_v1");
  });

  it("defaults off when unset", () => {
    delete process.env.DASHBOARD_SUMMARIES_V1;
    delete process.env.NEXT_PUBLIC_DASHBOARD_SUMMARIES_V1;
    expect(isDashboardSummariesV1Enabled()).toBe(false);
  });

  it("is on when DASHBOARD_SUMMARIES_V1=true", () => {
    process.env.DASHBOARD_SUMMARIES_V1 = "true";
    delete process.env.NEXT_PUBLIC_DASHBOARD_SUMMARIES_V1;
    expect(isDashboardSummariesV1Enabled()).toBe(true);
  });

  it("is on when NEXT_PUBLIC_DASHBOARD_SUMMARIES_V1=true", () => {
    delete process.env.DASHBOARD_SUMMARIES_V1;
    process.env.NEXT_PUBLIC_DASHBOARD_SUMMARIES_V1 = "true";
    expect(isDashboardSummariesV1Enabled()).toBe(true);
  });

  it("ignores other truthy strings", () => {
    process.env.DASHBOARD_SUMMARIES_V1 = "1";
    process.env.NEXT_PUBLIC_DASHBOARD_SUMMARIES_V1 = "yes";
    expect(isDashboardSummariesV1Enabled()).toBe(false);
  });
});
