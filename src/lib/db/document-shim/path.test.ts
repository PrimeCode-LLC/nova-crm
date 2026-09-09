import { describe, expect, it } from "vitest";
import {
  isImmediateCollectionDocument,
  pathMatchesCollectionGroup,
} from "@/lib/db/document-shim/path";

describe("isImmediateCollectionDocument", () => {
  const collection =
    "organizations/org1/members/uid1/emailMailboxes";

  it("accepts direct mailbox profile docs", () => {
    expect(
      isImmediateCollectionDocument(
        `${collection}/mb-aaa`,
        collection,
      ),
    ).toBe(true);
  });

  it("rejects nested sendStats / inboxSync docs", () => {
    expect(
      isImmediateCollectionDocument(
        `${collection}/mb-aaa/sendStats/2026-08-06`,
        collection,
      ),
    ).toBe(false);
    expect(
      isImmediateCollectionDocument(
        `${collection}/mb-aaa/inboxSync/heads`,
        collection,
      ),
    ).toBe(false);
  });

  it("rejects the collection path itself", () => {
    expect(isImmediateCollectionDocument(collection, collection)).toBe(false);
  });
});

describe("pathMatchesCollectionGroup", () => {
  it("matches only the document parent collection id", () => {
    expect(
      pathMatchesCollectionGroup(
        "organizations/org1/members/uid1/emailMailboxes/mb-aaa",
        "emailMailboxes",
      ),
    ).toBe(true);
    expect(
      pathMatchesCollectionGroup(
        "organizations/org1/members/uid1/emailMailboxes/mb-aaa/sendStats/2026-08-06",
        "emailMailboxes",
      ),
    ).toBe(false);
    expect(
      pathMatchesCollectionGroup(
        "organizations/org1/members/uid1/emailMailboxes/mb-aaa/sendStats/2026-08-06",
        "sendStats",
      ),
    ).toBe(true);
  });

  it("does not treat an ancestor collection as a match", () => {
    expect(
      pathMatchesCollectionGroup(
        "organizations/org1/members/uid1/emailMailboxes/mb-aaa",
        "members",
      ),
    ).toBe(false);
  });
});
