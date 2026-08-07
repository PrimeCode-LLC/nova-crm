import type { BlogPost } from "@/lib/blog";

function Content() {
  return (
    <>
      <p>
        Most cold email tools still sell the same promise: build a five-step
        sequence, personalise the first line, and let it run. That model worked
        when volume was low and prospects behaved politely. It fails the moment
        reality shows up — a reply, an out-of-office, a soft no, or two weeks of
        silence.
      </p>
      <p>
        Static sequences assume the world is a straight line. Outbound is a
        branching tree. If your system cannot rewrite the plan per prospect, you
        are not running a journey. You are running a blast with delays.
      </p>

      <h2>The failure modes you already recognise</h2>
      <ul>
        <li>
          <strong>Reply ignored by the machine.</strong> Someone asks a real
          question while step 3 still fires two days later.
        </li>
        <li>
          <strong>OOO pile-up.</strong> Follow-ups stack while the prospect is
          away, then look aggressive when they return.
        </li>
        <li>
          <strong>Same campaign, every ICP.</strong> A partner lead and a
          price-shopper get identical cadence and proof points.
        </li>
        <li>
          <strong>&quot;Not now&quot; treated like a ghost.</strong> Interest
          that needed a nurture path gets the same hard close as a hot demo ask.
        </li>
      </ul>

      <h2>What replaces the static sequence</h2>
      <p>
        Think in <strong>prospect journeys</strong>, not campaign steps. A
        journey has a goal (book the meeting), a starting plan, and rules for
        rewriting that plan when new signal arrives:
      </p>
      <ol>
        <li>Interest or meeting ask → pause sequence, surface draft, prioritise</li>
        <li>Objection → classify, draft a grounded response, keep human in loop</li>
        <li>Out-of-office → wait, then resume without the spam backlog</li>
        <li>Opt-out or hard bounce → stop everywhere, immediately</li>
        <li>Silence past threshold → change angle or channel, do not just nudge louder</li>
      </ol>

      <h2>Personalisation is more than merge tags</h2>
      <p>
        First-name and company tokens are table stakes. What converts is
        relevance grounded in how you sell: services, ICP language, case
        studies, and approved lines. If AI cannot cite a source for a claim, the
        claim should not ship. That standard beats &quot;clever&quot; copy that
        invents case studies overnight.
      </p>

      <h2>How to audit your current sequences this week</h2>
      <p>Pick your top-performing sequence and answer:</p>
      <ul>
        <li>What happens in the tool the second a reply lands?</li>
        <li>Who owns drafting the next message — you, or a queue of unread threads?</li>
        <li>Can two prospects on the same list be on different plans after day three?</li>
        <li>Would you defend every automated sentence in front of a customer?</li>
      </ul>
      <p>
        If any answer makes you uncomfortable, the sequence is the problem —
        not your list quality alone.
      </p>

      <h2>The Nova approach</h2>
      <p>
        Nova writes a plan per prospect, then rewrites it when they reply, go
        dark, or say not now. Sequences pause on reply, honour opt-outs, and put
        the next move in front of you with a draft ready to approve. That is what
        &quot;stop babysitting sequences&quot; means in practice.
      </p>
      <p>
        Want that motion on your outbound?{" "}
        <a href="/#waitlist">Join the Nova founding waitlist</a>.
      </p>
    </>
  );
}

export const post: BlogPost = {
  slug: "why-static-cold-email-sequences-fail",
  title: "Why static cold email sequences fail (and what replaces them)",
  description:
    "Static sequences break on replies, OOO, and soft nos. Prospect journeys that rewrite the plan are how modern outbound books meetings.",
  publishedAt: "2026-08-05",
  author: { name: "Nova Team", role: "Product" },
  tags: ["cold email", "sequences", "outbound"],
  readingTimeMin: 6,
  Content,
};
