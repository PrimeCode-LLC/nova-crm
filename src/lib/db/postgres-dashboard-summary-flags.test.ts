import { afterEach, describe, expect, it } from "vitest";

import {
  DASHBOARD_SUMMARIES_FIRESTORE_WRITER_V1_FLAG,
  POSTGRES_DASHBOARD_SUMMARY_READ_V1_FLAG,
  POSTGRES_DASHBOARD_SUMMARY_WRITER_V1_FLAG,
  isFirestoreOrgDashboardSummaryWriterEnabled,
  isPostgresDashboardSummaryReadEnabled,
  isPostgresDashboardSummaryWriterEnabled,
} from "@/lib/db/postgres-dashboard-summary-flags";

describe("postgres dashboard summary flags (P3.2–P3.4)", () => {
  afterEach(() => {
    delete process.env.POSTGRES_DASHBOARD_SUMMARY_WRITER_V1;
    delete process.env.POSTGRES_DASHBOARD_SUMMARY_READ_V1;
    delete process.env.NEXT_PUBLIC_POSTGRES_DASHBOARD_SUMMARY_READ_V1;
    delete process.env.DASHBOARD_SUMMARIES_FIRESTORE_WRITER_V1;
  });

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

  it("writer defaults off", () => {
    expect(isPostgresDashboardSummaryWriterEnabled()).toBe(false);
  });

  it("writer enables when env is true", () => {
    process.env.POSTGRES_DASHBOARD_SUMMARY_WRITER_V1 = "true";
    expect(isPostgresDashboardSummaryWriterEnabled()).toBe(true);
  });

  it("reader defaults off", () => {
    expect(isPostgresDashboardSummaryReadEnabled()).toBe(false);
  });

  it("reader enables from server or public env", () => {
    process.env.POSTGRES_DASHBOARD_SUMMARY_READ_V1 = "true";
    expect(isPostgresDashboardSummaryReadEnabled()).toBe(true);
    delete process.env.POSTGRES_DASHBOARD_SUMMARY_READ_V1;
    process.env.NEXT_PUBLIC_POSTGRES_DASHBOARD_SUMMARY_READ_V1 = "true";
    expect(isPostgresDashboardSummaryReadEnabled()).toBe(true);
  });

  it("firestore writer defaults off (P3.4)", () => {
    expect(isFirestoreOrgDashboardSummaryWriterEnabled()).toBe(false);
  });

  it("firestore writer opt-in for rollback", () => {
    process.env.DASHBOARD_SUMMARIES_FIRESTORE_WRITER_V1 = "true";
    expect(isFirestoreOrgDashboardSummaryWriterEnabled()).toBe(true);
  });
});
