import type {
  EmailMailboxSettings,
  MailDraft,
  MailInbound,
  MailSent,
} from "@/lib/email-account-types";
import { defaultEmailMailboxSettings } from "@/lib/email-account-types";
import { mockLeads } from "@/lib/mock-data";

export const DEMO_MB_WORK = "demo-mb-work";
export const DEMO_MB_UPWORK = "demo-mb-upwork";

function isoMinutesAgo(m: number): string {
  return new Date(Date.now() - m * 60 * 1000).toISOString();
}

function inbound(
  partial: Omit<MailInbound, "id" | "uid" | "date" | "seen" | "preview" | "bodyText"> &
    Pick<MailInbound, "id" | "uid"> & {
      date?: string;
      seen?: boolean;
      preview?: string;
      bodyText?: string;
    },
): MailInbound {
  const bodyText =
    partial.bodyText ??
    partial.preview ??
    "This is sample inbox text for Nova CRM demo mode, no mail server is contacted.";
  const preview = partial.preview ?? bodyText.slice(0, 140).replace(/\s+/g, " ").trim();
  return {
    ...partial,
    date: partial.date ?? isoMinutesAgo(30),
    seen: partial.seen ?? false,
    preview,
    bodyText,
  };
}

/**
 * Rich local-only email data for Demo mode (mailboxes, inbox threads, sent, drafts, one lead link).
 */
export function buildDemoEmailSeed(): {
  mailboxes: EmailMailboxSettings[];
  activeMailboxId: string;
  inboundByMailbox: Record<string, MailInbound[]>;
  drafts: MailDraft[];
  sent: MailSent[];
  linkedLeadByMessageId: Record<string, string>;
} {
  const L1 = mockLeads[0]!;
  const L2 = mockLeads[2] ?? mockLeads[1]!;
  const leadEmail = (L1.contactEmail ?? "").toLowerCase();
  const L1mail = L1.contactEmail ?? "contact@demo.nova";
  const L2mail = L2.contactEmail ?? "contact2@demo.nova";
  const L1first = (L1.contactName ?? "there").split(/\s+/)[0] ?? "there";

  const mbWork = defaultEmailMailboxSettings({
    id: DEMO_MB_WORK,
    label: "Work, Outbound",
    enabled: true,
    displayName: "Sarah Chen",
    emailAddress: "sarah.chen@nova.co",
    replyTo: "sarah.chen@nova.co",
    signature: "Sarah Chen\nOutbound, Nova CRM (demo)",
    smtp: { host: "", port: 587, secure: false, user: "", password: "" },
    imap: { host: "", port: 993, secure: true, user: "", password: "" },
  });

  const mbUpwork = defaultEmailMailboxSettings({
    id: DEMO_MB_UPWORK,
    label: "Upwork, Marcus",
    enabled: true,
    displayName: "Marcus Webb",
    emailAddress: "marcus.webb@nova.co",
    replyTo: "marcus.webb@nova.co",
    signature: "Marcus Webb\nUpwork closers, Nova CRM (demo)",
    smtp: { host: "", port: 587, secure: false, user: "", password: "" },
    imap: { host: "", port: 993, secure: true, user: "", password: "" },
  });

  const msgA1 = inbound({
    id: "din-w-a1",
    uid: 11001,
    subject: "Re: Pilot scope, security questionnaire",
    from: `"${L1.contactName ?? "Contact"}" <${L1mail}>`,
    to: "Sarah Chen <sarah.chen@nova.co>",
    cc: "security@acmecorp-demo.io",
    date: isoMinutesAgo(120),
    seen: false,
    messageId: "demo-msg-a-root@nova.local",
    preview: "Attached our IT checklist. Can you confirm SSO + audit log export for the pilot?",
    bodyText: `Hi Sarah,\n\nAttached our IT checklist. Can you confirm SSO + audit log export for the 30-day pilot?\n\nThanks,\n${L1.contactName}`,
    attachments: [
      {
        filename: "IT-checklist-demo.txt",
        mimeType: "text/plain",
        sizeBytes: 36,
        contentBase64: Buffer.from("Demo checklist attachment (Nova CRM demo mode).").toString("base64"),
      },
    ],
  });

  const msgA2 = inbound({
    id: "din-w-a2",
    uid: 11002,
    subject: "Re: Pilot scope, security questionnaire",
    from: "Sarah Chen <sarah.chen@nova.co>",
    to: `"${L1.contactName ?? "Contact"}" <${L1mail}>`,
    date: isoMinutesAgo(90),
    seen: true,
    messageId: "demo-msg-a-reply@nova.local",
    inReplyTo: "demo-msg-a-root@nova.local",
    referenceIds: ["demo-msg-a-root@nova.local", "demo-msg-a-reply@nova.local"],
    preview: "Yes, we support SAML SSO and 90-day audit retention on Growth. I'll send the one-pager.",
    bodyText:
      "Yes, we support SAML SSO and 90-day audit retention on Growth. I'll send the one-pager next.\n\nSarah",
  });

  const msgB = inbound({
    id: "din-w-b1",
    uid: 11003,
    subject: "Quick question on seat bundling",
    from: "operations@acmecorp-demo.io",
    to: "Sarah Chen <sarah.chen@nova.co>",
    date: isoMinutesAgo(400),
    seen: true,
    messageId: "demo-msg-b@nova.local",
    preview: "Do you offer read-only seats for finance reviewers? We have 4 stakeholders who only approve.",
    bodyText:
      "Hi Sarah,\n\nDo you offer read-only seats for finance reviewers? We have 4 stakeholders who only approve quotes.\n\n- Ops",
  });

  const msgC = inbound({
    id: "din-w-c1",
    uid: 11004,
    subject: "Fwd: Intro, Nova x Riverline logistics",
    from: "James Mitchell <james.mitchell@nova.co>",
    to: "Sarah Chen <sarah.chen@nova.co>",
    date: isoMinutesAgo(2000),
    seen: true,
    messageId: "demo-msg-c@nova.local",
    preview: "Looping you in with Riverline, they want outbound + inbound in one workspace.",
    bodyText:
      "Sarah, looping you in with Riverline logistics. They want outbound + inbound in one workspace next quarter.\n\nJames",
  });

  const u1 = inbound({
    id: "din-u-1",
    uid: 21001,
    subject: "Proposal submitted, CRM integration (fixed price)",
    from: "Upwork Notifications <noreply@upwork.com>",
    to: "Marcus Webb <marcus.webb@nova.co>",
    date: isoMinutesAgo(60),
    seen: false,
    messageId: "demo-upwork-1@nova.local",
    preview: "A freelancer submitted a proposal for your job post \"CRM integration for B2B team\".",
    bodyText:
      "A freelancer submitted a proposal for your job post \"CRM integration for B2B team\".\n\nOpen Upwork to review (demo).",
  });

  const u2 = inbound({
    id: "din-u-2",
    uid: 21002,
    subject: `Re: ${L2.companyName ?? "Account"}, discovery call notes`,
    from: `"${L2.contactName ?? "Contact"}" <${L2mail}>`,
    to: "Marcus Webb <marcus.webb@nova.co>",
    date: isoMinutesAgo(340),
    seen: true,
    messageId: "demo-upwork-thread@nova.local",
    preview: "Thanks for yesterday, can you send pricing for 15 seats + onboarding week?",
    bodyText: `Marcus,\n\nThanks for yesterday, can you send pricing for 15 seats + onboarding week?\n\n${L2.contactName}`,
  });

  const drafts: MailDraft[] = [
    {
      id: "demo-draft-w1",
      mailboxId: DEMO_MB_WORK,
      to: L1mail,
      subject: `Re: ${L1.companyName ?? "Account"}, next steps`,
      body: `Hi ${L1first},\n\nFollowing up on timeline for the pilot kickoff.\n\nSarah`,
      updatedAt: isoMinutesAgo(25),
    },
    {
      id: "demo-draft-u1",
      mailboxId: DEMO_MB_UPWORK,
      to: L2mail,
      subject: "Proposal, Nova rollout (week 1–2)",
      body: "Hi, here's the fixed-scope plan we discussed on the call…\n\nMarcus",
      updatedAt: isoMinutesAgo(180),
    },
  ];

  const sent: MailSent[] = [
    {
      id: "demo-sent-w1",
      mailboxId: DEMO_MB_WORK,
      from: "sarah.chen@nova.co",
      to: L1mail,
      subject: "Nova, pilot checklist + security PDF",
      body: `Hi ${L1.contactName ?? "there"},\n\nSharing the pilot checklist and security overview you asked for.\n\nSarah`,
      sentAt: isoMinutesAgo(1500),
    },
    {
      id: "demo-sent-w2",
      mailboxId: DEMO_MB_WORK,
      from: "sarah.chen@nova.co",
      to: "partnerships@riverline-demo.io",
      subject: "Riverline, consolidated outbound + inbound",
      body: "James asked me to send a one-slide overview of how we consolidate outbound + inbound…",
      sentAt: isoMinutesAgo(2100),
    },
    {
      id: "demo-sent-u1",
      mailboxId: DEMO_MB_UPWORK,
      from: "marcus.webb@nova.co",
      to: L2mail,
      subject: "Upwork, next milestones for CRM integration",
      body: "Confirming deliverables for week 1: schema mapping, webhook stubs, and QA checklist.\n\nMarcus",
      sentAt: isoMinutesAgo(720),
    },
  ];

  const linkedLeadByMessageId: Record<string, string> = {};
  if (leadEmail) {
    linkedLeadByMessageId[`${DEMO_MB_WORK}:in:${msgA1.id}`] = L1.id;
  }

  return {
    mailboxes: [mbWork, mbUpwork],
    activeMailboxId: DEMO_MB_WORK,
    inboundByMailbox: {
      [DEMO_MB_WORK]: [msgA1, msgA2, msgB, msgC],
      [DEMO_MB_UPWORK]: [u1, u2],
    },
    drafts,
    sent,
    linkedLeadByMessageId,
  };
}
