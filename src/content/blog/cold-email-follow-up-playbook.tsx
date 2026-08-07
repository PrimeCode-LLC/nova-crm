import type { BlogPost } from "@/lib/blog";

function Content() {
  return (
    <>
      <p>
        Most cold email advice obsesses over the first touch. Meetings are
        usually won or lost in the follow-ups — the messages that arrive after
        silence, after a soft reply, or after an out-of-office clears.
      </p>
      <p>
        The goal is not more nudges. It is a follow-up system that stays useful,
        respectful, and impossible to drop when the list gets large.
      </p>

      <h2>What good follow-up is trying to do</h2>
      <ul>
        <li>Add a new reason to respond (proof, angle, timing) — not &quot;bumping this&quot;</li>
        <li>Match the prospect&apos;s last signal, not your calendar anxiety</li>
        <li>Stop cleanly when they opt out or say no</li>
        <li>Resume intelligently after absence instead of dumping a backlog</li>
      </ul>

      <h2>A practical cadence without the spam feel</h2>
      <p>
        Exact timing depends on ACV and market, but the structure holds for most
        B2B service and SaaS outbound:
      </p>
      <ol>
        <li>
          <strong>Touch 1:</strong> specific observation + clear ask
        </li>
        <li>
          <strong>Touch 2:</strong> different proof point (case study, outcome,
          constraint you solve)
        </li>
        <li>
          <strong>Touch 3:</strong> alternate angle or stakeholder (not the same
          pitch louder)
        </li>
        <li>
          <strong>Touch 4:</strong> permission-based close or breakup that leaves
          the door open
        </li>
      </ol>
      <p>
        Space them so a human could still explain each send. If you would be
        embarrassed to read the thread aloud, the cadence is wrong.
      </p>

      <h2>Follow-ups must react to signal</h2>
      <p>
        Silence, OOO, &quot;interesting — Q4,&quot; and &quot;send pricing&quot;
        cannot share one template path. Branch:
      </p>
      <ul>
        <li>
          <strong>Silence:</strong> change value, do not escalate pressure
        </li>
        <li>
          <strong>OOO:</strong> pause; resume after return with one clean message
        </li>
        <li>
          <strong>Delay:</strong> schedule the next touch for the date they gave
        </li>
        <li>
          <strong>Objection:</strong> answer the objection; do not continue the
          original sequence as if nothing happened
        </li>
      </ul>

      <h2>Deliverability is part of the playbook</h2>
      <p>
        Follow-up discipline dies if mailboxes burn. Pace per mailbox, respect
        volume caps and warm-up, surface bounces for review, and suppress
        opt-outs and hard bounces across the workspace immediately. Volume that
        never lands is not a pipeline strategy.
      </p>

      <h2>Automate the chase, keep the judgement</h2>
      <p>
        Founders should not manually remember thousands of resume dates. The
        system should. Humans should approve what still needs a brand voice —
        especially early, and especially on high-value accounts.
      </p>
      <p>
        Nova runs follow-ups that pause, resume, and never drop — with drafts
        grounded in how you sell and approval gates you control.{" "}
        <a href="/#waitlist">Join the waitlist</a> if that is the playbook you
        want running daily.
      </p>
    </>
  );
}

export const post: BlogPost = {
  slug: "cold-email-follow-up-playbook",
  title: "The cold email follow-up playbook that does not annoy prospects",
  description:
    "Meetings are won in follow-ups. A cadence that adds value, branches on signal, and pauses for OOO — without burning deliverability.",
  publishedAt: "2026-07-28",
  author: { name: "Nova Team", role: "Product" },
  tags: ["cold email", "follow-up", "deliverability"],
  readingTimeMin: 7,
  Content,
};
