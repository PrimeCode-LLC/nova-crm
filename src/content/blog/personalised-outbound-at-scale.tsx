import type { BlogPost } from "@/lib/blog";

function Content() {
  return (
    <>
      <p>
        &quot;Personalisation at scale&quot; became shorthand for merge tags and
        scraped first lines. Prospects learned to spot it. Deliverability teams
        learned to punish it. The teams still booking meetings did something
        quieter: they personalised the <em>plan</em>, not just the greeting.
      </p>

      <h2>Personalisation that moves revenue</h2>
      <p>Useful personalisation answers three questions in the prospect&apos;s language:</p>
      <ul>
        <li>Why you, why now?</li>
        <li>What proof looks like for someone in my situation?</li>
        <li>What is the smallest next step that respects my time?</li>
      </ul>
      <p>
        That requires your ICP, offers, and case studies — not a witty line about
        their latest LinkedIn post that every other tool also saw.
      </p>

      <h2>Scale the system, not the spam</h2>
      <ol>
        <li>
          <strong>Segment before you generate.</strong> Bad ICP at volume is
          still bad ICP.
        </li>
        <li>
          <strong>Generate from approved knowledge.</strong> If a claim is not
          in the knowledge base, it does not ship.
        </li>
        <li>
          <strong>Vary the journey.</strong> Two prospects can share a goal and
          still need different proof and timing after day two.
        </li>
        <li>
          <strong>Keep a human gate.</strong> Especially on first sends and new
          offers. Scale trust gradually.
        </li>
        <li>
          <strong>Protect the mailbox.</strong> Pacing, warm-up, bounce review,
          and instant suppression beat clever copy that never lands.
        </li>
      </ol>

      <h2>Signals that your &quot;personalisation&quot; is fake</h2>
      <ul>
        <li>Every email could swap company names and still read the same</li>
        <li>Follow-ups ignore the content of the reply</li>
        <li>You would not let a junior send it without edits — yet automation does</li>
        <li>Positive replies stall because nobody drafted the next move</li>
      </ul>

      <h2>What Nova means by personalised outbound</h2>
      <p>
        Nova builds a plan per prospect from how you sell, rewrites that plan
        when signal changes, and drafts replies with sources attached. Volume
        grows; the headcount line does not have to. You approve what matters.
      </p>
      <p>
        Ready for personalisation that can survive a customer reading it twice?{" "}
        <a href="/#waitlist">Reserve your founding slot</a>.
      </p>
    </>
  );
}

export const post: BlogPost = {
  slug: "personalised-outbound-at-scale",
  title: "Personalised outbound at scale without sounding like spam",
  description:
    "Real personalisation is a plan per prospect grounded in your proof — not merge tags. How to scale outbound without burning trust.",
  publishedAt: "2026-07-08",
  author: { name: "Nova Team", role: "Product" },
  tags: ["personalisation", "outbound", "deliverability"],
  readingTimeMin: 5,
  Content,
};
