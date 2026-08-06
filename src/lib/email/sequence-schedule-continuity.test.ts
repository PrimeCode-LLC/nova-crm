import { describe, expect, it } from "vitest";
import {
  countContinuityPreflight,
  planHasPriorSentEmailSteps,
  resolvePriorSequenceRecipient,
  resolvePriorSequenceSender,
} from "@/lib/email/sequence-schedule-continuity";
import type { EmailMailboxSettings, ScheduledEmail } from "@/lib/email-account-types";
import type { Followup } from "@/lib/types";

function followup(partial: Partial<Followup> & { id: string }): Followup {
  return {
    title: partial.title ?? partial.id,
    dueAt: partial.dueAt ?? "2026-01-01T10:00:00.000Z",
    ownerId: "u1",
    priority: "medium",
    auto: true,
    ...partial,
  };
}

const mailboxes = [
  {
    id: "mb-a",
    emailAddress: "a@mailtech.com",
    label: "A",
  },
  {
    id: "mb-b",
    emailAddress: "b@mailtech.com",
    label: "B",
  },
] as EmailMailboxSettings[];

describe("sequence schedule continuity", () => {
  it("detects prior sent steps", () => {
    expect(
      planHasPriorSentEmailSteps([
        followup({ id: "f1", deliveryStatus: "sent", sentMessageId: "m1" }),
        followup({ id: "f2" }),
      ]),
    ).toBe(true);
    expect(planHasPriorSentEmailSteps([followup({ id: "f2" })])).toBe(false);
  });

  it("resolves prior sender from durable followup mailbox fields", () => {
    const planFollowups = [
      followup({
        id: "f1",
        deliveryStatus: "sent",
        sentAt: "2026-01-01T10:05:00.000Z",
        sentMessageId: "root@x",
        mailboxId: "mb-a",
        fromEmail: "a@mailtech.com",
        toEmail: "lead@acme.com",
      }),
      followup({ id: "f2", dueAt: "2026-01-05T10:00:00.000Z" }),
    ];

    expect(
      resolvePriorSequenceSender({
        planFollowups,
        scheduledEmails: [],
        mailboxes,
      }),
    ).toEqual({
      mailboxId: "mb-a",
      fromEmail: "a@mailtech.com",
      followupId: "f1",
    });
  });

  it("resolves prior sender from cancelled step mailbox when history is gone", () => {
    expect(
      resolvePriorSequenceSender({
        planFollowups: [
          followup({
            id: "f1",
            deliveryStatus: "sent",
            sentAt: "2026-01-01T10:05:00.000Z",
            sentMessageId: "root@x",
          }),
          followup({
            id: "f2",
            deliveryStatus: "cancelled",
            mailboxId: "mb-b",
            fromEmail: "b@mailtech.com",
            toEmail: "lead@acme.com",
          }),
        ],
        scheduledEmails: [],
        mailboxes,
      }),
    ).toEqual({
      mailboxId: "mb-b",
      fromEmail: "b@mailtech.com",
      followupId: "f2",
    });
  });

  it("resolves prior recipient from remembered toEmail", () => {
    expect(
      resolvePriorSequenceRecipient({
        planFollowups: [
          followup({
            id: "f1",
            toEmail: "lead@acme.com",
            deliveryStatus: "sent",
            sentAt: "2026-01-01T10:00:00.000Z",
          }),
        ],
        recipientEmails: ["other@x.com", "lead@acme.com"],
      }),
    ).toBe("lead@acme.com");
  });

  it("resolves prior sender from scheduled email history", () => {
    const planFollowups = [
      followup({
        id: "f1",
        deliveryStatus: "sent",
        sentAt: "2026-01-01T10:05:00.000Z",
        sentMessageId: "root@x",
        scheduledEmailId: "sch-1",
      }),
      followup({ id: "f2", dueAt: "2026-01-05T10:00:00.000Z" }),
    ];
    const scheduled = [
      {
        id: "sch-1",
        mailboxId: "mb-a",
        from: "a@mailtech.com",
        to: "lead@acme.com",
        subject: "Hi",
        body: "x",
        scheduledAt: "2026-01-01T10:00:00.000Z",
        status: "sent",
        createdAt: "2026-01-01T09:00:00.000Z",
        followupId: "f1",
        sentAt: "2026-01-01T10:05:00.000Z",
      },
    ] as ScheduledEmail[];

    expect(
      resolvePriorSequenceSender({
        planFollowups,
        scheduledEmails: scheduled,
        mailboxes,
      }),
    ).toEqual({
      mailboxId: "mb-a",
      fromEmail: "a@mailtech.com",
      followupId: "f1",
    });
  });

  it("counts first-touch vs continuing ready leads", () => {
    const counts = countContinuityPreflight({
      readyLeadIds: ["l1", "l2", "l3"],
      planFollowupsByLeadId: new Map([
        ["l1", [followup({ id: "a" })]],
        [
          "l2",
          [
            followup({
              id: "b1",
              deliveryStatus: "sent",
              sentMessageId: "m",
              scheduledEmailId: "sch-b",
            }),
            followup({ id: "b2" }),
          ],
        ],
        [
          "l3",
          [followup({ id: "c1", deliveryStatus: "sent", sentAt: "2026-01-01T00:00:00.000Z" })],
        ],
      ]),
      scheduledEmails: [
        {
          id: "sch-b",
          mailboxId: "mb-b",
          from: "b@mailtech.com",
          to: "x@y.com",
          subject: "Hi",
          body: "x",
          scheduledAt: "2026-01-01T10:00:00.000Z",
          status: "sent",
          createdAt: "2026-01-01T09:00:00.000Z",
          followupId: "b1",
        },
      ] as ScheduledEmail[],
      mailboxes,
    });

    expect(counts).toEqual({
      firstTouch: 1,
      continuing: 2,
      priorSenderKnown: 1,
      priorSenderUnknown: 1,
    });
  });
});
