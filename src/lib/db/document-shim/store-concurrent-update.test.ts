import { describe, expect, it } from "vitest";
import { isDatabaseConfigured } from "@/lib/db/prisma";
import { FIELD_DELETE } from "@/lib/db/document-shim/field-values";
import { getPgFirestore } from "@/lib/db/document-shim/shim-firestore";
import { coerceInstantMs } from "@/lib/db/document-shim/timestamp";
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
    // Dates round-trip as Timestamp, so compare the instant rather than the shape.
    expect(coerceInstantMs(after?.payload.dueAt)).toBe(
      Date.parse("2026-09-25T14:30:00.000Z"),
    );
    expect(after?.payload.scheduledEmailId).toBeUndefined();
    expect(after?.payload.emailScheduledAt).toBeUndefined();
    expect(after?.payload.title).toBe("Step 2");

    await deleteDocument(path);
  });
});

describe.runIf(runIntegration)("document transaction isolation (integration)", () => {
  const organizationId = `org-test-tx-${Date.now()}`;

  it("does not lose a concurrent counter increment", async () => {
    const path = `followups/test-tx-counter-${Date.now()}`;
    const db = getPgFirestore();
    const ref = db.collection("followups").doc(path.split("/")[1]!);
    await setDocument(path, { organizationId, booked: 0 }, false);

    // Read-modify-write of the same counter from two requests at once: with a
    // real transaction each sees the other's committed value.
    const bump = () =>
      db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        const used = Number((snap.data() as { booked?: unknown })?.booked ?? 0);
        tx.set(ref, { organizationId, booked: used + 1 }, { merge: true });
      });
    await Promise.all([bump(), bump()]);

    expect((await getDocument(path))?.payload.booked).toBe(2);
    await deleteDocument(path);
  });

  it("rolls back every write when the callback throws", async () => {
    const path = `followups/test-tx-rollback-${Date.now()}`;
    const otherPath = `followups/test-tx-rollback-other-${Date.now()}`;
    const db = getPgFirestore();
    const ref = db.collection("followups").doc(path.split("/")[1]!);
    const otherRef = db.collection("followups").doc(otherPath.split("/")[1]!);
    await setDocument(path, { organizationId, title: "before" }, false);

    await expect(
      db.runTransaction(async (tx) => {
        await tx.get(ref);
        tx.set(ref, { organizationId, title: "after" }, { merge: true });
        tx.set(otherRef, { organizationId, title: "orphan" }, { merge: false });
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    expect((await getDocument(path))?.payload.title).toBe("before");
    expect(await getDocument(otherPath)).toBeNull();
    await deleteDocument(path);
  });
});
