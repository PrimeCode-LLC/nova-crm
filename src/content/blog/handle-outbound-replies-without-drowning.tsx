import type { BlogPost } from "@/lib/blog";

function Content() {
  return (
    <>
      <p>
        Outbound volume only creates pipeline if replies get handled. Most teams
        discover the opposite: the more they send, the more the inbox becomes a
        graveyard of half-read threads, late responses, and meetings that should
        have been booked last Tuesday.
      </p>
      <p>
        Reply handling is the hidden capacity limit of founder-led sales. An AI
        that only writes openers does not fix it. You need an inbox that arrives
        with the next move already written.
      </p>

      <h2>Why &quot;just check email more often&quot; fails</h2>
      <p>
        Replies are not equal. A demo ask, a pricing objection, a referral, a
        polite delay, and a hard no all need different actions — and different
        urgency. Treating them as one unread count guarantees the wrong threads
        get attention first.
      </p>
      <p>
        Manual triage also fights the sequence engine. If follow-ups keep firing
        while you are still deciding how to answer, you look careless even when
        you care.
      </p>

      <h2>Classify before you open</h2>
      <p>
        High-performing outbound teams treat every reply as structured signal:
      </p>
      <ul>
        <li>
          <strong>Intent</strong> — interested, objection, referral, delay,
          meeting ask, unsubscribe, out-of-office
        </li>
        <li>
          <strong>Sentiment</strong> — warm, neutral, frustrated, closed
        </li>
        <li>
          <strong>Priority score</strong> — what deserves a human in the next
          hour versus the next day
        </li>
        <li>
          <strong>Next action</strong> — not another label, a concrete move
        </li>
      </ul>
      <p>
        Classification without a draft still leaves you writing under pressure.
        Classification with a draft means you approve, edit, or take over — in
        one click.
      </p>

      <h2>Pause the journey the moment they talk back</h2>
      <p>
        The non-negotiable rule: when a prospect replies, the automated sequence
        stops instantly. Resume only after the human decision is made, or when
        the system has a clear, approved path (for example, a scheduled nudge
        after a &quot;circle back next quarter&quot;).
      </p>
      <p>
        Same discipline for out-of-office and opt-out. Absence should pause.
        Opt-out should suppress across the workspace — not live as a sticky note
        someone forgets.
      </p>

      <h2>A lightweight reply SLA for small teams</h2>
      <ol>
        <li>Meeting asks and warm interest: same business day</li>
        <li>Objections with a real question: within one business day</li>
        <li>Soft delays: logged with a resume date, not left in limbo</li>
        <li>Opt-outs and hard nos: suppressed immediately, no heroics</li>
      </ol>
      <p>
        You cannot hit those SLAs at volume without triage and drafts waiting
        when you open the thread.
      </p>

      <h2>How Nova handles replies</h2>
      <p>
        In Nova, every reply lands classified, scored, and paired with a next
        action and a draft grounded in your knowledge base. The sequence pauses
        the moment the reply arrives. You stay in control; the system does the
        reading and the first draft.
      </p>
      <p>
        If reply chaos is the bottleneck behind your outbound,{" "}
        <a href="/#waitlist">get on the Nova waitlist</a> and tell us how your
        inbox looks today.
      </p>
    </>
  );
}

export const post: BlogPost = {
  slug: "handle-outbound-replies-without-drowning",
  title: "How to handle every outbound reply without drowning your inbox",
  description:
    "Outbound volume dies in the inbox. Classify intent, pause sequences, and approve drafts so replies become meetings — not backlog.",
  publishedAt: "2026-08-03",
  author: { name: "Nova Team", role: "Product" },
  tags: ["reply handling", "inbox", "AI sales"],
  readingTimeMin: 6,
  Content,
};
