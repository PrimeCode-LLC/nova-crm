import { describe, expect, it } from "vitest";
import { isSubjectOnlyMailBody, shouldKeepPreviousMailBody } from "@/lib/email/mail-body-stub";

describe("isSubjectOnlyMailBody", () => {
  it("treats empty text as missing", () => {
    expect(isSubjectOnlyMailBody({ subject: "Email 1 - Intro", bodyText: "" })).toBe(true);
  });

  it("treats subject-as-body stubs as missing", () => {
    expect(
      isSubjectOnlyMailBody({
        subject: "Email 1 - Intro",
        bodyText: "Email 1 - Intro",
      }),
    ).toBe(true);
  });

  it("keeps real bodies", () => {
    expect(
      isSubjectOnlyMailBody({
        subject: "Email 1 - Intro",
        bodyText: "Hi Sam, quick note about your checkout flow…",
      }),
    ).toBe(false);
  });

  it("keeps html bodies", () => {
    expect(
      isSubjectOnlyMailBody({
        subject: "Email 1 - Intro",
        bodyText: "Email 1 - Intro",
        bodyHtml: "<p>Hi Sam</p>",
      }),
    ).toBe(false);
  });
});

describe("shouldKeepPreviousMailBody", () => {
  it("does not let a subject stub overwrite a real body", () => {
    expect(
      shouldKeepPreviousMailBody({
        prev: {
          subject: "Email 1 - Intro",
          bodyText: "Hi Sam, here is the actual outreach email.",
          bodySynced: true,
        },
        incoming: {
          subject: "Email 1 - Intro",
          bodyText: "Email 1 - Intro",
          bodySynced: true,
        },
      }),
    ).toBe(true);
  });

  it("accepts a richer incoming body", () => {
    expect(
      shouldKeepPreviousMailBody({
        prev: {
          subject: "Email 1 - Intro",
          bodyText: "Email 1 - Intro",
          bodySynced: true,
        },
        incoming: {
          subject: "Email 1 - Intro",
          bodyText: "Hi Sam, fetched from IMAP sent.",
          bodyHtml: "<p>Hi Sam, fetched from IMAP sent.</p>",
          bodySynced: true,
        },
      }),
    ).toBe(false);
  });
});
