import assert from "node:assert/strict";
import test from "node:test";
import { __test } from "./prospectImportWorker";

test("deterministic IDs make retried rows idempotent", () => {
  const first = __test.deterministicId("l", "job-1:42");
  const retried = __test.deterministicId("l", "job-1:42");
  const different = __test.deterministicId("l", "job-1:43");
  assert.equal(first, retried);
  assert.notEqual(first, different);
});

test("contact identities are normalized and deduplicated", () => {
  assert.deepEqual(
    __test.identityValues({
      companyEmail: "PERSON@EXAMPLE.COM",
      personalEmail: "person@example.com",
      contactLinkedIn: "https://linkedin.com/in/person/",
      phone: "+1 (555) 555-0100",
    }),
    [
      "email:person@example.com",
      "linkedin:https://linkedin.com/in/person",
      "phone:+15555550100",
    ],
  );
});

test("lead mapping always creates a prospect with safe defaults", () => {
  const lead = __test.leadValues(
    {
      companyName: "Acme",
      companyDomain: "acme.example",
      firstName: "Jane",
      lastName: "Doe",
      ownerEmail: "u-owner",
      createdByEmail: "u-creator",
      sourcedByEmail: "u-source",
      prospectOwnerEmail: "u-owner",
    },
    "a-1",
    "ct-1",
    "2026-07-17T00:00:00.000Z",
  );
  assert.equal(lead.intakeKind, "prospect");
  assert.equal(lead.prospectVisibility, "open");
  assert.equal(lead.stage, "new");
  assert.equal(lead.touches, 0);
  assert.equal(lead.isIdle, false);
});

test("lead update mapping preserves omitted operational fields", () => {
  const lead = __test.leadValues(
    {
      companyName: "Acme",
      companyDomain: "acme.example",
      firstName: "Jane",
      lastName: "Doe",
      ownerEmail: "u-owner",
    },
    "a-1",
    "ct-1",
    "2026-07-17T00:00:00.000Z",
    false,
  );
  for (const key of [
    "channel",
    "stage",
    "temperature",
    "priority",
    "prospectVisibility",
    "doNotContact",
    "touches",
    "isIdle",
  ]) {
    assert.equal(key in lead, false, `${key} should be preserved when omitted`);
  }
});

test("transient Firestore errors are retried", () => {
  assert.equal(__test.isRetryableError({ code: 14 }), true);
  assert.equal(__test.isRetryableError({ code: "firestore/unavailable" }), true);
  assert.equal(__test.isRetryableError({ code: "permission-denied" }), false);
});

test("worker processing limits cap rows, chunks, and retries", () => {
  const row = {
    rowNumber: 1,
    normalized: {},
    issues: [],
    identity: "email:person@example.com",
    existingProspectIds: [],
  };
  const chunk = {
    organizationId: "org-1",
    jobId: "job-1",
    index: 0,
    status: "queued",
    rows: Array.from({ length: 40 }, () => row),
    attemptCount: 0,
  };
  const job = {
    organizationId: "org-1",
    uploaderId: "user-1",
    filename: "prospects.csv",
    status: "queued",
    policy: "add_new" as const,
    chunkCount: 250,
    completedChunks: 0,
    counts: {},
  };

  assert.equal(__test.processingLimitError(chunk, job), undefined);
  assert.match(
    __test.processingLimitError({ ...chunk, rows: [...chunk.rows, row] }, job) ?? "",
    /40-row/,
  );
  assert.match(
    __test.processingLimitError(chunk, { ...job, chunkCount: 251 }) ?? "",
    /250-chunk/,
  );
  assert.match(
    __test.processingLimitError({ ...chunk, attemptCount: 3 }, job) ?? "",
    /3-attempt/,
  );
});
