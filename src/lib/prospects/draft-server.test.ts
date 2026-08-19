import { beforeEach, describe, expect, it, vi } from "vitest";
import crypto from "node:crypto";
import { Timestamp } from "@/lib/db/document-shim/shim-firestore";
import { getAdminDb } from "@/lib/db/document-access/admin";
import { COLLECTIONS } from "@/lib/documents/collections";
import { emptyProspectForm } from "./prospect-form";
import {
  ProspectDraftRevisionError,
  addSourceToWorkingDraft,
  completeProspectDraft,
  createManualProspectDraft,
  createAndSelectWorkingDraft,
  decodeProspectDraftCursor,
  encodeProspectDraftCursor,
  getProspectDraft,
  listProspectDraftPage,
  updateProspectDraftFields,
} from "./draft-server";

vi.mock("@/lib/db/document-access/admin", () => ({ getAdminDb: vi.fn() }));
vi.mock("@/lib/ai/run-feature", () => ({
  runAiStructuredFeature: vi.fn().mockRejectedValue(new Error("AI unavailable")),
}));

type Row = Record<string, unknown>;

class FakeSnapshot {
  constructor(
    readonly id: string,
    private readonly row?: Row,
  ) {}
  get exists() {
    return this.row !== undefined;
  }
  data() {
    return this.row;
  }
}

class FakeRef {
  constructor(
    private readonly db: FakeFirestore,
    readonly collectionId: string,
    readonly id: string,
  ) {}
  get key() {
    return `${this.collectionId}/${this.id}`;
  }
  get() {
    return Promise.resolve(this.db.snapshot(this));
  }
  create(value: Row) {
    if (this.db.rows.has(this.key)) return Promise.reject(new Error("already exists"));
    this.db.rows.set(this.key, { ...value });
    return Promise.resolve();
  }
}

class FakeQuery {
  private filters: Array<[string, unknown]> = [];
  private limitCount = Number.POSITIVE_INFINITY;
  private startAfterId?: string;
  constructor(
    private readonly db: FakeFirestore,
    private readonly collectionId: string,
  ) {}
  where(field: string, _operator: string, value: unknown) {
    this.filters.push([field, value]);
    return this;
  }
  limit(_value: number) {
    this.limitCount = _value;
    return this;
  }
  orderBy() {
    return this;
  }
  startAfter(_timestamp: unknown, id: string) {
    this.startAfterId = id;
    return this;
  }
  async get() {
    let docs = [...this.db.rows.entries()]
      .filter(([key]) => key.startsWith(`${this.collectionId}/`))
      .map(([key, row]) => new FakeSnapshot(key.slice(this.collectionId.length + 1), row))
      .filter((snapshot) =>
        this.filters.every(([field, value]) => snapshot.data()?.[field] === value),
      );
    if (this.startAfterId) {
      const index = docs.findIndex((document) => document.id === this.startAfterId);
      docs = index >= 0 ? docs.slice(index + 1) : docs;
    }
    docs = docs.slice(0, this.limitCount);
    return { docs };
  }
}

class FakeTransaction {
  private writes: Array<() => void> = [];
  constructor(private readonly db: FakeFirestore) {}
  get(ref: FakeRef) {
    return Promise.resolve(this.db.snapshot(ref));
  }
  create(ref: FakeRef, value: Row) {
    this.writes.push(() => {
      if (this.db.rows.has(ref.key)) throw new Error("already exists");
      this.db.rows.set(ref.key, { ...value });
    });
  }
  set(ref: FakeRef, value: Row, options?: { merge?: boolean }) {
    this.writes.push(() => {
      const current = this.db.rows.get(ref.key) ?? {};
      this.db.rows.set(ref.key, options?.merge ? { ...current, ...value } : { ...value });
    });
  }
  delete(ref: FakeRef) {
    this.writes.push(() => this.db.rows.delete(ref.key));
  }
  commit() {
    this.writes.forEach((write) => write());
  }
}

class FakeFirestore {
  readonly rows = new Map<string, Row>();
  private transactionTail: Promise<void> = Promise.resolve();
  collection(id: string) {
    const query = new FakeQuery(this, id);
    return Object.assign(query, {
      doc: (documentId: string) => new FakeRef(this, id, documentId),
    });
  }
  snapshot(ref: FakeRef) {
    return new FakeSnapshot(ref.id, this.rows.get(ref.key));
  }
  runTransaction<T>(callback: (transaction: FakeTransaction) => Promise<T>): Promise<T> {
    const run = this.transactionTail.then(async () => {
      const transaction = new FakeTransaction(this);
      const result = await callback(transaction);
      transaction.commit();
      return result;
    });
    this.transactionTail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }
  seed(collectionId: string, id: string, value: Row) {
    this.rows.set(`${collectionId}/${id}`, { ...value });
  }
}

function seedCompletableDraft(
  db: FakeFirestore,
  id: string,
  email: string,
  companyName = `Company ${id}`,
) {
  const form = emptyProspectForm();
  Object.assign(form, {
    bizName: companyName,
    firstName: "Ada",
    lastName: id,
    email,
    triggerEvent: "Expansion",
  });
  form.qualifyForm.qualifyStatus = "incomplete";
  db.seed(COLLECTIONS.prospectDrafts, id, {
    organizationId: "org-1",
    userId: "user-1",
    status: "active",
    origin: "manual",
    revision: 0,
    fields: {
      companyName: {
        value: form.bizName,
        confidence: 1,
        status: "verified",
        evidence: [],
        updatedAt: "2026-07-21T00:00:00.000Z",
      },
      contactName: {
        value: `${form.firstName} ${form.lastName}`,
        confidence: 1,
        status: "verified",
        evidence: [],
        updatedAt: "2026-07-21T00:00:00.000Z",
      },
    },
    form,
    sources: [],
    sourceCount: 0,
    createdAt: "2026-07-21T00:00:00.000Z",
    updatedAt: "2026-07-21T00:00:00.000Z",
  });
}

beforeEach(() => {
  vi.mocked(getAdminDb).mockReset();
});

describe("prospect draft cursors", () => {
  it("round-trips Firestore timestamp precision and document id", () => {
    const cursor = {
      id: "pd-2",
      updatedAt: { seconds: 1_774_000_000, nanoseconds: 987_654_321 },
    };
    expect(decodeProspectDraftCursor(encodeProspectDraftCursor(cursor))).toEqual(cursor);
  });

  it("rejects malformed cursors", () => {
    expect(() => decodeProspectDraftCursor("not-a-cursor")).toThrow(
      "Invalid prospect draft cursor.",
    );
  });
});

describe("ProspectDraftRevisionError", () => {
  it("exposes a stable conflict code and current revision", () => {
    const error = new ProspectDraftRevisionError(7);
    expect(error).toMatchObject({
      code: "revision_conflict",
      currentRevision: 7,
    });
  });
});

describe("legacy prospect draft hydration", () => {
  it("infers extension origin from embedded sources when sourceCount is absent", async () => {
    const db = new FakeFirestore();
    db.seed(COLLECTIONS.prospectDrafts, "legacy-source-draft", {
      organizationId: "org-1",
      userId: "user-1",
      status: "active",
      fields: {},
      sources: [
        {
          id: "source-1",
          url: "https://example.com",
          title: "Example",
          domain: "example.com",
          capturedAt: "2026-07-21T00:00:00.000Z",
        },
      ],
      createdAt: "2026-07-21T00:00:00.000Z",
      updatedAt: "2026-07-21T00:00:00.000Z",
    });
    vi.mocked(getAdminDb).mockReturnValue(db as never);

    await expect(
      getProspectDraft({
        organizationId: "org-1",
        userId: "user-1",
        draftId: "legacy-source-draft",
      }),
    ).resolves.toMatchObject({ origin: "intent_radar", sourceCount: 1 });
  });
});

describe("prospect draft transactions", () => {
  it("allows multiple active manual drafts without acquiring an extension pointer", async () => {
    const db = new FakeFirestore();
    vi.mocked(getAdminDb).mockReturnValue(db as never);

    const [first, second] = await Promise.all([
      createManualProspectDraft({ organizationId: "org-1", userId: "user-1" }),
      createManualProspectDraft({ organizationId: "org-1", userId: "user-1" }),
    ]);

    expect(first.id).not.toBe(second.id);
    expect(
      [...db.rows.keys()].filter((key) => key.startsWith(`${COLLECTIONS.prospectDrafts}/`)),
    ).toHaveLength(2);
    expect(
      [...db.rows.keys()].filter((key) => key.startsWith(`${COLLECTIONS.prospectDraftLocks}/`)),
    ).toHaveLength(0);
  });

  it("rejects stale revisions during updates", async () => {
    const db = new FakeFirestore();
    seedCompletableDraft(db, "stale-draft", "stale@example.com");
    vi.mocked(getAdminDb).mockReturnValue(db as never);

    await expect(
      updateProspectDraftFields({
        organizationId: "org-1",
        userId: "user-1",
        draftId: "stale-draft",
        values: { companyName: "Changed" },
        expectedRevision: 3,
      }),
    ).rejects.toMatchObject({ code: "revision_conflict", currentRevision: 0 });
  });

  it("creates and selects idempotently in one transaction", async () => {
    const db = new FakeFirestore();
    vi.mocked(getAdminDb).mockReturnValue(db as never);

    const [first, retry] = await Promise.all([
      createAndSelectWorkingDraft({
        organizationId: "org-1",
        userId: "user-1",
        idempotencyKey: "request-1",
      }),
      createAndSelectWorkingDraft({
        organizationId: "org-1",
        userId: "user-1",
        idempotencyKey: "request-1",
      }),
    ]);

    expect(retry.id).toBe(first.id);
    expect(
      [...db.rows.keys()].filter((key) => key.startsWith(`${COLLECTIONS.prospectDrafts}/`)),
    ).toHaveLength(1);
    expect(
      [...db.rows.values()].find((row) => row.draftId === first.id),
    ).toMatchObject({ organizationId: "org-1", userId: "user-1" });
  });

  it("commits deterministic source and draft updates exactly once", async () => {
    const db = new FakeFirestore();
    seedCompletableDraft(db, "draft-source", "ada@example.com");
    vi.mocked(getAdminDb).mockReturnValue(db as never);
    const input = {
      organizationId: "org-1",
      userId: "user-1",
      draftId: "draft-source",
      idempotencyKey: "capture-1",
      source: {
        url: "https://example.com/news",
        title: "News",
        domain: "example.com",
        text: "Example company announced a meaningful expansion into a new market.",
      },
      finding: {
        quality: { score: 50, matchedSignalIds: ["growth"] },
      },
    };

    const first = await addSourceToWorkingDraft(input);
    const retry = await addSourceToWorkingDraft(input);

    expect(first.draft.sources).toHaveLength(1);
    expect(retry.draft.sources).toHaveLength(1);
    expect(
      [...db.rows.keys()].filter((key) =>
        key.startsWith(`${COLLECTIONS.prospectDraftSources}/`),
      ),
    ).toHaveLength(1);
  });

  it("serializes identity reservations across concurrent completions", async () => {
    const db = new FakeFirestore();
    db.seed(COLLECTIONS.organizations, "org-1", {});
    seedCompletableDraft(db, "draft-a", "same@example.com");
    seedCompletableDraft(db, "draft-b", "same@example.com");
    vi.mocked(getAdminDb).mockReturnValue(db as never);

    const results = await Promise.all([
      completeProspectDraft({
        organizationId: "org-1",
        userId: "user-1",
        draftId: "draft-a",
      }),
      completeProspectDraft({
        organizationId: "org-1",
        userId: "user-1",
        draftId: "draft-b",
      }),
    ]);

    expect(results.filter((result) => "leadId" in result)).toHaveLength(1);
    expect(results.filter((result) => "error" in result)).toEqual([
      { error: "A contact with this email already exists." },
    ]);
    expect(
      [...db.rows.keys()].filter((key) => key.startsWith(`${COLLECTIONS.contacts}/`)),
    ).toHaveLength(1);
  });

  it("returns the same lead on completion retry and conditionally clears its pointer", async () => {
    const db = new FakeFirestore();
    const pointerId = crypto.createHash("sha256").update("org-1:user-1").digest("hex");
    db.seed(COLLECTIONS.organizations, "org-1", {});
    seedCompletableDraft(db, "retry-draft", "retry@example.com");
    db.seed(COLLECTIONS.prospectDraftLocks, pointerId, {
      organizationId: "org-1",
      userId: "user-1",
      draftId: "retry-draft",
    });
    vi.mocked(getAdminDb).mockReturnValue(db as never);

    const first = await completeProspectDraft({
      organizationId: "org-1",
      userId: "user-1",
      draftId: "retry-draft",
    });
    const retry = await completeProspectDraft({
      organizationId: "org-1",
      userId: "user-1",
      draftId: "retry-draft",
    });

    expect(retry).toEqual(first);
    expect(db.rows.has(`${COLLECTIONS.prospectDraftLocks}/${pointerId}`)).toBe(false);
  });

  it("serializes per-company contact limits across concurrent completions", async () => {
    const db = new FakeFirestore();
    db.seed(COLLECTIONS.organizations, "org-1", {});
    seedCompletableDraft(db, "draft-1", "one@example.com", "Same Company");
    seedCompletableDraft(db, "draft-2", "two@example.com", "Same Company");
    seedCompletableDraft(db, "draft-3", "three@example.com", "Same Company");
    vi.mocked(getAdminDb).mockReturnValue(db as never);

    const results = await Promise.all(
      ["draft-1", "draft-2", "draft-3"].map((draftId) =>
        completeProspectDraft({
          organizationId: "org-1",
          userId: "user-1",
          draftId,
        }),
      ),
    );

    expect(results.filter((result) => "leadId" in result)).toHaveLength(2);
    expect(results.filter((result) => "error" in result)).toEqual([
      {
        error: "This company already has the maximum of 2 contacts for this owner.",
      },
    ]);
  });
});

describe("server-side draft filtering", () => {
  it("filters before selecting a page, including across scan chunks", async () => {
    const db = new FakeFirestore();
    for (let index = 0; index < 60; index += 1) {
      db.seed(COLLECTIONS.prospectDrafts, `draft-${index}`, {
        organizationId: "org-1",
        userId: "user-1",
        status: "active",
        origin: "manual",
        revision: 0,
        fields: {},
        form: { ...emptyProspectForm(), bizName: `Other ${index}` },
        sources: [],
        sourceCount: 0,
        createdAt: Timestamp.fromMillis(1_000 - index),
        updatedAt: Timestamp.fromMillis(1_000 - index),
      });
    }
    db.seed(COLLECTIONS.prospectDrafts, "draft-target", {
      organizationId: "org-1",
      userId: "user-1",
      status: "active",
      origin: "intent_radar",
      revision: 0,
      fields: {},
      form: {
        ...emptyProspectForm(),
        bizName: "Needle Company",
        firstName: "Ada",
        lastName: "Lovelace",
      },
      sources: [],
      sourceCount: 0,
      createdAt: Timestamp.fromMillis(1),
      updatedAt: Timestamp.fromMillis(1),
    });
    vi.mocked(getAdminDb).mockReturnValue(db as never);

    const page = await listProspectDraftPage({
      organizationId: "org-1",
      userId: "user-1",
      origin: "intent_radar",
      readiness: "ready",
      search: "needle",
      limit: 1,
    });

    expect(page.drafts.map((draft) => draft.id)).toEqual(["draft-target"]);
  });
});
