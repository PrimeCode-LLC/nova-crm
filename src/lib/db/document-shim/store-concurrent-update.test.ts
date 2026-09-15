import { describe, expect, it } from "vitest";
import { isDatabaseConfigured } from "@/lib/db/prisma";
import { FIELD_DELETE } from "@/lib/db/document-shim/field-values";
import {
  deleteDocument,
  getDocument,
  setDocument,
  updateDocument,
} from "@/lib/db/document-shim/store";

const runIntegration =
  process.env.DOCUMENT_STORE_INTEGRATION === "true" &&
  Boolean(process.env.DATABASE_URL?.trim()) &&
  isDatabaseConfigured();

describe.runIf(runIntegration)("document store concurrent update (integration)", () => {
  const path = `followups/test-concurrent-${Date.now()}`;
  const organizationId = `org-test-doc-${Date.now()}`;

  it("keeps both fields when two patches race on one document", async () => {
    await setDocument(
      path,
      {
        organizationId,
        title: "Step 2",
        dueAt: "2026-09-20T09:00:00.000Z",
        scheduledEmailId: "se-1",
        emailScheduledAt: "2026-09-20T09:00:00.000Z",
      },
      false,
    );

    // Reschedule issues these two patches concurrently: clear the queue link and
    // move the due date. Neither may clobber the other.
    await Promise.all([
      updateDocument(path, {
        scheduledEmailId: FIELD_DELETE,
        emailScheduledAt: FIELD_DELETE,
      }),
      updateDocument(path, { dueAt: "2026-09-25T14:30:00.000Z" }),
    ]);

    const after = await getDocument(path);
    expect(after?.payload.dueAt).toBe("2026-09-25T14:30:00.000Z");
    expect(after?.payload.scheduledEmailId).toBeUndefined();
    expect(after?.payload.emailScheduledAt).toBeUndefined();
    expect(after?.payload.title).toBe("Step 2");

    await deleteDocument(path);
  });
});
