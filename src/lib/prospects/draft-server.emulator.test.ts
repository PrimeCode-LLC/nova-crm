import { readFile } from "node:fs/promises";
import crypto from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { deleteApp, initializeApp } from "firebase-admin/app";
import { FieldValue, Timestamp, getFirestore } from "firebase-admin/firestore";
import {
  assertFails,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { getAdminDb } from "@/lib/firebase/admin";
import { COLLECTIONS } from "@/lib/firestore/collections";
import { emptyProspectForm } from "./prospect-form";
import {
  completeProspectDraft,
  createAndSelectWorkingDraft,
  createManualProspectDraft,
  getProspectDraft,
  listProspectDraftPage,
} from "./draft-server";

vi.mock("@/lib/firebase/admin", () => ({ getAdminDb: vi.fn() }));
vi.mock("@/lib/ai/run-feature", () => ({
  runAiStructuredFeature: vi.fn().mockRejectedValue(new Error("AI unavailable")),
}));

const emulatorAvailable = Boolean(process.env.FIRESTORE_EMULATOR_HOST);
const emulatorDescribe = emulatorAvailable ? describe : describe.skip;
const projectId = "demo-crm-prospect-drafts";

function completableForm(suffix: string) {
  const form = emptyProspectForm();
  form.bizName = `Company ${suffix}`;
  form.firstName = "Ada";
  form.lastName = suffix;
  form.email = `${suffix}@example.com`;
  form.triggerEvent = "Expansion";
  form.qualifyForm.qualifyStatus = "incomplete";
  return form;
}

emulatorDescribe("prospect drafts against the Firestore emulator", () => {
  const adminApp = initializeApp({ projectId }, "prospect-draft-emulator-tests");
  const db = getFirestore(adminApp);
  let rules: RulesTestEnvironment;

  beforeAll(async () => {
    rules = await initializeTestEnvironment({
      projectId,
      firestore: {
        host: "127.0.0.1",
        port: 8180,
        rules: await readFile("firestore.rules", "utf8"),
      },
    });
    vi.mocked(getAdminDb).mockReturnValue(db);
  });

  beforeEach(async () => {
    await rules.clearFirestore();
    vi.mocked(getAdminDb).mockReturnValue(db);
  });

  afterAll(async () => {
    await rules.cleanup();
    await deleteApp(adminApp);
  });

  it("creates multiple active manual drafts concurrently without a pointer", async () => {
    const drafts = await Promise.all(
      Array.from({ length: 5 }, () =>
        createManualProspectDraft({ organizationId: "org-1", userId: "user-1" }),
      ),
    );

    expect(new Set(drafts.map((draft) => draft.id))).toHaveLength(5);
    const active = await listProspectDraftPage({
      organizationId: "org-1",
      userId: "user-1",
      status: "active",
      limit: 10,
    });
    expect(active.drafts).toHaveLength(5);
    expect(
      (await db.collection(COLLECTIONS.prospectDraftLocks).get()).empty,
    ).toBe(true);
  });

  it("completes the same draft concurrently and returns one stable lead", async () => {
    await db.collection(COLLECTIONS.organizations).doc("org-1").set({});
    const draft = await createManualProspectDraft({
      organizationId: "org-1",
      userId: "user-1",
      form: completableForm("same-draft"),
    });

    const [first, second] = await Promise.all([
      completeProspectDraft({
        organizationId: "org-1",
        userId: "user-1",
        draftId: draft.id,
      }),
      completeProspectDraft({
        organizationId: "org-1",
        userId: "user-1",
        draftId: draft.id,
      }),
    ]);

    expect(first).toEqual(second);
    expect((await db.collection(COLLECTIONS.leads).get()).size).toBe(1);
  });

  it("only clears the extension pointer when it still targets the completed draft", async () => {
    await db.collection(COLLECTIONS.organizations).doc("org-1").set({});
    const older = await createAndSelectWorkingDraft({
      organizationId: "org-1",
      userId: "user-1",
      form: completableForm("older"),
    });
    const newer = await createAndSelectWorkingDraft({
      organizationId: "org-1",
      userId: "user-1",
    });

    await completeProspectDraft({
      organizationId: "org-1",
      userId: "user-1",
      draftId: older.id,
    });

    const pointerId = crypto.createHash("sha256").update("org-1:user-1").digest("hex");
    const pointer = await db.collection(COLLECTIONS.prospectDraftLocks).doc(pointerId).get();
    expect(pointer.data()?.draftId).toBe(newer.id);
  });

  it("paginates beyond 100 drafts without crossing owner or tenant boundaries", async () => {
    const batchSize = 125;
    const batch = db.batch();
    for (let index = 0; index < batchSize; index += 1) {
      const ref = db.collection(COLLECTIONS.prospectDrafts).doc(`owned-${index}`);
      batch.set(ref, {
        organizationId: "org-1",
        userId: "user-1",
        status: "active",
        origin: "manual",
        revision: 0,
        fields: {},
        sources: [],
        sourceCount: 0,
        createdAt: Timestamp.fromMillis(10_000 - index),
        updatedAt: Timestamp.fromMillis(10_000 - index),
        createdBy: "user-1",
        updatedBy: "user-1",
      });
    }
    batch.set(db.collection(COLLECTIONS.prospectDrafts).doc("other-user"), {
      organizationId: "org-1",
      userId: "user-2",
      status: "active",
      origin: "manual",
      revision: 0,
      fields: {},
      sources: [],
      sourceCount: 0,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    batch.set(db.collection(COLLECTIONS.prospectDrafts).doc("other-org"), {
      organizationId: "org-2",
      userId: "user-1",
      status: "active",
      origin: "manual",
      revision: 0,
      fields: {},
      sources: [],
      sourceCount: 0,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    await batch.commit();

    const first = await listProspectDraftPage({
      organizationId: "org-1",
      userId: "user-1",
      status: "active",
      limit: 100,
    });
    const second = await listProspectDraftPage({
      organizationId: "org-1",
      userId: "user-1",
      status: "active",
      limit: 100,
      cursor: first.nextCursor,
    });

    expect(first.drafts).toHaveLength(100);
    expect(second.drafts).toHaveLength(25);
    expect(
      [...first.drafts, ...second.drafts].every(
        (draft) => draft.organizationId === "org-1" && draft.userId === "user-1",
      ),
    ).toBe(true);
    await expect(
      getProspectDraft({
        organizationId: "org-2",
        userId: "user-1",
        draftId: "owned-0",
      }),
    ).resolves.toBeNull();
  });

  it("denies direct client access to every server-only draft collection", async () => {
    const client = rules.authenticatedContext("user-1", { organizationId: "org-1" }).firestore();
    for (const collection of [
      COLLECTIONS.prospectDrafts,
      COLLECTIONS.prospectDraftSources,
      COLLECTIONS.prospectDraftLocks,
      COLLECTIONS.prospectDraftReservations,
    ]) {
      await assertFails(client.collection(collection).doc("blocked").get());
      await assertFails(client.collection(collection).doc("blocked").set({ value: true }));
    }
  });
});
