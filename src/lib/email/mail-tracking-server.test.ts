import { beforeEach, describe, expect, it, vi } from "vitest";
import { getAdminDb } from "@/lib/firebase/admin";
import { COLLECTIONS } from "@/lib/firestore/collections";
import {
  isLikelyMailScannerUserAgent,
  recordMailTrackingOpen,
} from "@/lib/email/mail-tracking-server";

vi.mock("@/lib/firebase/admin", () => ({ getAdminDb: vi.fn() }));
vi.mock("@/lib/firestore/resolve-owner-manager-ids-admin", () => ({
  resolveOwnerManagerIdsAdmin: vi.fn().mockResolvedValue([]),
}));

type Row = Record<string, unknown>;

function isIncrementTransform(raw: unknown): boolean {
  if (!raw || typeof raw !== "object") return false;
  const name = (raw as { constructor?: { name?: string } }).constructor?.name ?? "";
  return name.includes("Increment");
}

function applyPatch(current: Row, value: Row): Row {
  const next = { ...current };
  for (const [key, raw] of Object.entries(value)) {
    if (isIncrementTransform(raw)) {
      const operand =
        typeof (raw as { operand?: unknown }).operand === "number"
          ? (raw as { operand: number }).operand
          : 1;
      next[key] = (Number(current[key] ?? 0) || 0) + operand;
    } else {
      next[key] = raw;
    }
  }
  return next;
}

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
  set(value: Row, options?: { merge?: boolean }) {
    const current = this.db.rows.get(this.key) ?? {};
    const incoming = applyPatch({}, value);
    // Re-apply increments against current so counts accumulate correctly.
    const mergedIncoming = applyPatch(current, value);
    this.db.rows.set(
      this.key,
      options?.merge ? { ...current, ...mergedIncoming } : incoming,
    );
    return Promise.resolve();
  }
}

class FakeTransaction {
  constructor(private readonly db: FakeFirestore) {}
  get(ref: FakeRef) {
    return Promise.resolve(this.db.snapshot(ref));
  }
  update(ref: FakeRef, value: Row) {
    const current = this.db.rows.get(ref.key);
    if (!current) throw new Error("missing");
    this.db.rows.set(ref.key, applyPatch(current, value));
  }
}

class FakeFirestore {
  rows = new Map<string, Row>();
  collection(collectionId: string) {
    return {
      doc: (id: string) => new FakeRef(this, collectionId, id),
    };
  }
  snapshot(ref: FakeRef) {
    return new FakeSnapshot(ref.id, this.rows.get(ref.key));
  }
  runTransaction<T>(callback: (tx: FakeTransaction) => Promise<T>): Promise<T> {
    return callback(new FakeTransaction(this));
  }
}

describe("isLikelyMailScannerUserAgent", () => {
  it("flags common scanner / proxy UAs", () => {
    expect(isLikelyMailScannerUserAgent("GoogleImageProxy")).toBe(true);
    expect(isLikelyMailScannerUserAgent("Yahoo! Slurp")).toBe(true);
    expect(isLikelyMailScannerUserAgent("Mozilla/5.0 (Macintosh)")).toBe(false);
    expect(isLikelyMailScannerUserAgent("")).toBe(false);
    expect(isLikelyMailScannerUserAgent(null)).toBe(false);
  });
});

describe("recordMailTrackingOpen", () => {
  let db: FakeFirestore;

  beforeEach(() => {
    db = new FakeFirestore();
    vi.mocked(getAdminDb).mockReturnValue(db as never);
  });

  it("skips scanner UAs without writing", async () => {
    db.rows.set(`${COLLECTIONS.mailTrackingMessages}/trk-1`, {
      organizationId: "org-1",
      leadId: "lead-1",
      trackOpens: true,
      openCount: 0,
    });
    const result = await recordMailTrackingOpen({
      trackingId: "trk-1",
      userAgent: "GoogleImageProxy",
    });
    expect(result).toEqual({ ok: true });
    expect(db.rows.get(`${COLLECTIONS.mailTrackingMessages}/trk-1`)?.openCount).toBe(0);
    expect(db.rows.get(`${COLLECTIONS.leads}/lead-1`)).toBeUndefined();
  });

  it("stamps lead + timeline on first open only", async () => {
    db.rows.set(`${COLLECTIONS.mailTrackingMessages}/trk-1`, {
      organizationId: "org-1",
      leadId: "lead-1",
      messageId: "<msg-1@x>",
      mailboxId: "mb-1",
      trackOpens: true,
      openCount: 0,
    });
    db.rows.set(`${COLLECTIONS.leads}/lead-1`, {
      organizationId: "org-1",
      ownerId: "u1",
      emailOpenCount: 0,
    });

    const first = await recordMailTrackingOpen({
      trackingId: "trk-1",
      userAgent: "Mozilla/5.0",
    });
    expect(first).toEqual({ ok: true });

    const tracking = db.rows.get(`${COLLECTIONS.mailTrackingMessages}/trk-1`)!;
    expect(tracking.openCount).toBe(1);
    expect(typeof tracking.firstOpenedAt).toBe("string");
    expect(typeof tracking.lastOpenedAt).toBe("string");

    const lead = db.rows.get(`${COLLECTIONS.leads}/lead-1`)!;
    expect(lead.lastEmailOpenedAt).toBe(tracking.firstOpenedAt);
    expect(lead.lastActivityAt).toBe(tracking.firstOpenedAt);
    expect(lead.emailOpenCount).toBe(1);

    const timelineEntries = [...db.rows.entries()].filter(([key]) =>
      key.startsWith(`${COLLECTIONS.timelineEvents}/`),
    );
    expect(timelineEntries).toHaveLength(1);
    expect(timelineEntries[0]?.[1].type).toBe("email_opened");
    expect(timelineEntries[0]?.[1].leadId).toBe("lead-1");
    expect(timelineEntries[0]?.[1].summary).toBe("Email opened");

    const second = await recordMailTrackingOpen({
      trackingId: "trk-1",
      userAgent: "Mozilla/5.0",
    });
    expect(second).toEqual({ ok: true });
    expect(db.rows.get(`${COLLECTIONS.mailTrackingMessages}/trk-1`)?.openCount).toBe(2);
    expect(
      [...db.rows.keys()].filter((key) => key.startsWith(`${COLLECTIONS.timelineEvents}/`)),
    ).toHaveLength(1);
  });
});
