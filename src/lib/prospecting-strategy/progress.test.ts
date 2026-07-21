import { describe, expect, it } from "vitest";
import type { Lead } from "@/lib/types";
import { countStrategyDayProgress } from "./progress";

function prospect(input: {
  id: string;
  assignmentId: string;
  status: "incomplete" | "completed" | "rejected";
}): Lead {
  return {
    id: input.id,
    accountId: `account-${input.id}`,
    contactId: `contact-${input.id}`,
    intakeKind: "prospect",
    strategyId: "strategy-1",
    strategyAssignmentId: input.assignmentId,
    scraperId: "user-1",
    prospectQualifyStatus: input.status,
    companyName: `Company ${input.id}`,
    contactName: `Contact ${input.id}`,
    ownerId: "user-1",
    stage: "new",
    temperature: "cold",
    priority: "medium",
    channel: "cold_email",
    touches: 0,
    isIdle: false,
    createdAt: "2026-07-21T09:00:00.000Z",
    updatedAt: "2026-07-21T09:00:00.000Z",
  } as Lead;
}

describe("countStrategyDayProgress assignment attribution", () => {
  it("counts only prospects from the selected assignment", () => {
    const progress = countStrategyDayProgress({
      leads: [
        prospect({ id: "1", assignmentId: "assignment-1", status: "completed" }),
        prospect({ id: "2", assignmentId: "assignment-1", status: "incomplete" }),
        prospect({ id: "3", assignmentId: "assignment-2", status: "completed" }),
      ],
      userId: "user-1",
      strategyId: "strategy-1",
      strategyAssignmentId: "assignment-1",
      now: new Date("2026-07-21T12:00:00.000Z"),
    });

    expect(progress.researched).toBe(2);
    expect(progress.completed).toBe(1);
    expect(progress.incomplete).toBe(1);
  });
});
