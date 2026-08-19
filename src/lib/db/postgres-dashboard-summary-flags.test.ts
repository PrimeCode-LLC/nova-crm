import { describe, expect, it } from "vitest";
import {
  DASHBOARD_SUMMARIES_FIRESTORE_WRITER_V1_FLAG,
  POSTGRES_DASHBOARD_SUMMARY_READ_V1_FLAG,
  POSTGRES_DASHBOARD_SUMMARY_WRITER_V1_FLAG,
  isFirestoreOrgDashboardSummaryWriterEnabled,
  isPostgresDashboardSummaryReadEnabled,
  isPostgresDashboardSummaryWriterEnabled,
} from "@/lib/db/postgres-dashboard-summary-flags";

describe("postgres dashboard summary flags (P7 always on)", () => {
  it("exposes flag ids", () => {
    expect(POSTGRES_DASHBOARD_SUMMARY_WRITER_V1_FLAG).toBe(
      "postgres_dashboard_summary_writer_v1",
    );
    expect(POSTGRES_DASHBOARD_SUMMARY_READ_V1_FLAG).toBe(
      "postgres_dashboard_summary_read_v1",
    );
    expect(DASHBOARD_SUMMARIES_FIRESTORE_WRITER_V1_FLAG).toBe(
      "dashboard_summaries_firestore_writer_v1",
    );
  });

  it("postgres reader and writer always enabled", () => {
    expect(isPostgresDashboardSummaryWriterEnabled()).toBe(true);
    expect(isPostgresDashboardSummaryReadEnabled()).toBe(true);
  });

  it("firestore writer always disabled", () => {
    expect(isFirestoreOrgDashboardSummaryWriterEnabled()).toBe(false);
  });
});
