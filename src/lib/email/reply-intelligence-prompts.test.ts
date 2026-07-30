import { describe, expect, it } from "vitest";

import { stripQuotedReply, replyTextOnly } from "@/lib/email/strip-quoted-reply";
import { buildInboundReplySignalBlock } from "@/lib/email/reply-signals";
import { AI_PROMPT_DEFAULTS, promptTemplateIsCurrent } from "@/lib/ai/prompt-defaults";

describe("stripQuotedReply", () => {
  it("cuts the Gmail attribution trail", () => {
    const raw = [
      "Sounds useful, can you send pricing?",
      "",
      "On Tue, Jul 28, 2026 at 3:11 PM Sam Rep <sam@us.com> wrote:",
      "> We help teams cut dispatch time.",
      "> Worth a look?",
    ].join("\n");

    const out = stripQuotedReply(raw);
    expect(out.text).toBe("Sounds useful, can you send pricing?");
    expect(out.hadQuotedTrail).toBe(true);
  });

  it("handles a wrapped attribution line where wrote: lands on its own line", () => {
    const raw = [
      "Not the right person, talk to Dana.",
      "",
      "On Tue, Jul 28, 2026 at 3:11 PM Sam Rep <sam@a-very-long-domain.example.com>",
      "wrote:",
      "> original pitch",
    ].join("\n");

    expect(replyTextOnly(raw)).toBe("Not the right person, talk to Dana.");
  });

  it("cuts Outlook header blocks and original-message dividers", () => {
    const outlook = ["We're all set for now.", "", "From: Sam Rep", "Sent: Monday", "To: Dana"].join(
      "\n",
    );
    expect(replyTextOnly(outlook)).toBe("We're all set for now.");

    const original = ["Interested.", "", "-----Original Message-----", "old pitch"].join("\n");
    expect(replyTextOnly(original)).toBe("Interested.");
  });

  it("drops a trailing signature block", () => {
    const raw = ["Let's talk Thursday.", "", "-- ", "Dana Lee", "VP Ops"].join("\n");
    const out = stripQuotedReply(raw);
    expect(out.text).toBe("Let's talk Thursday.");
    expect(out.hadSignature).toBe(true);
  });

  it("keeps the original when the message is only a quote", () => {
    const raw = ["On Tue, Jul 28, 2026 at 3:11 PM Sam Rep <sam@us.com> wrote:", "> pitch"].join(
      "\n",
    );
    expect(stripQuotedReply(raw).text).toContain("pitch");
  });
});

describe("buildInboundReplySignalBlock", () => {
  const base = {
    from: "Dana Lee <dana@acme.com>",
    subject: "Re: dispatch times",
    receivedAt: "2026-07-30T10:00:00.000Z",
    leadContactEmail: "dana@acme.com",
  };

  it("flags opt-out language and identifies the lead contact", () => {
    const block = buildInboundReplySignalBlock({
      ...base,
      body: "Please remove me from your list.",
    });
    expect(block).toContain("opt-out or unsubscribe request language");
    expect(block).toContain("Sender is the lead contact: yes");
  });

  it("notices a colleague replying from the same domain", () => {
    const block = buildInboundReplySignalBlock({
      ...base,
      from: "Priya Shah <priya@acme.com>",
      body: "Dana asked me to reply. Can you share pricing?",
    });
    expect(block).toContain("same company domain");
    expect(block).toContain("pricing, budget, or proposal language");
  });

  it("does not flag our own quoted footer because the body arrives stripped", () => {
    const stripped = replyTextOnly(
      [
        "Thanks, not right now.",
        "",
        "On Tue, Jul 28, 2026 at 3:11 PM Sam Rep <sam@us.com> wrote:",
        "> Unsubscribe here if you'd rather not hear from us.",
      ].join("\n"),
    );
    const block = buildInboundReplySignalBlock({ ...base, body: stripped });
    expect(block).not.toContain("opt-out or unsubscribe request language");
    expect(block).toContain("timing deferral language");
  });
});

describe("reply prompt defaults", () => {
  it("ship the placeholders the reply routes depend on", () => {
    expect(
      promptTemplateIsCurrent("email_reply", AI_PROMPT_DEFAULTS.email_reply.userPromptTemplate),
    ).toBe(true);
    expect(
      promptTemplateIsCurrent(
        "email_reply_classify",
        AI_PROMPT_DEFAULTS.email_reply_classify.userPromptTemplate,
      ),
    ).toBe(true);
  });

  it("rejects a pre-guidance override so the default wins", () => {
    expect(promptTemplateIsCurrent("email_reply", "Thread:\n{{thread}}")).toBe(false);
    expect(promptTemplateIsCurrent("email_reply_classify", "Body:\n{{body}}")).toBe(false);
  });
});
