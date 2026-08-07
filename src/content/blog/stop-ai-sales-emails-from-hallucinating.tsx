import type { BlogPost } from "@/lib/blog";

function Content() {
  return (
    <>
      <p>
        The fastest way to lose trust with AI sales email is a sentence you
        cannot defend. Invented case studies, inflated metrics, &quot;we work
        with Fortune 500 brands&quot; when you do not — prospects notice, and so
        do the teammates who inherit the thread.
      </p>
      <p>
        Hallucination is not a model quirk you shrug off in outbound. It is a
        brand and legal risk. The fix is not &quot;write better prompts.&quot;
        It is a system that refuses to ship claims it cannot ground.
      </p>

      <h2>Why generic AI copy invents things</h2>
      <p>
        Large language models are trained to produce fluent continuation, not
        verified company facts. If your prompt says &quot;sound credible&quot;
        without attaching the only facts you allow, the model will borrow
        patterns from the internet-shaped average of B2B email. That average
        includes claims you never approved.
      </p>

      <h2>Grounding beats cleverness</h2>
      <p>
        Grounded outbound means every outbound claim maps to something you
        provided:
      </p>
      <ul>
        <li>Services and offers you actually sell</li>
        <li>ICP definitions and disqualifiers</li>
        <li>Case studies, logos, and proof points you can stand behind</li>
        <li>Approved lines, pricing frames, and phrases you already use</li>
      </ul>
      <p>
        When the system cannot find a source, it should <strong>cut the
        claim</strong> — not guess a softer version of the same lie.
      </p>

      <h2>Operational rules that keep AI honest</h2>
      <ol>
        <li>
          <strong>Source-attached drafts.</strong> Show which knowledge items
          informed the message so a human can spot drift in seconds.
        </li>
        <li>
          <strong>Approval gates by risk.</strong> New senders and new offers
          get tighter review; trusted motions can loosen later.
        </li>
        <li>
          <strong>Same standard across the team.</strong> One knowledge base,
          one claim policy — not five reps with five prompt libraries.
        </li>
        <li>
          <strong>Audit trail.</strong> Who approved what, and whether a human
          or the system produced the draft.
        </li>
      </ol>

      <h2>A 15-minute knowledge base checklist</h2>
      <ul>
        <li>List the three outcomes you can prove for customers</li>
        <li>Write two case study blurbs with real constraints (industry, scope)</li>
        <li>Add phrases you never want used (guarantees, competitor digs)</li>
        <li>Define who is not a fit — AI should not chase bad ICP to hit volume</li>
      </ul>
      <p>
        That package is enough to stop most fabrication. Volume without it is
        just faster embarrassment.
      </p>

      <h2>How Nova enforces this</h2>
      <p>
        Nova writes against your knowledge base and attaches sources. If it
        cannot ground a claim, it removes the claim rather than guessing. That
        is how you get personalised outbound at scale without gambling the brand
        on every send.
      </p>
      <p>
        Building outbound you can defend?{" "}
        <a href="/#waitlist">Reserve a Nova founding slot</a>.
      </p>
    </>
  );
}

export const post: BlogPost = {
  slug: "stop-ai-sales-emails-from-hallucinating",
  title: "How to stop AI sales emails from inventing claims about your business",
  description:
    "AI outbound fails when it fabricates proof. Ground every claim in your knowledge base — or cut the claim before it sends.",
  publishedAt: "2026-08-01",
  author: { name: "Nova Team", role: "Product" },
  tags: ["AI sales", "knowledge base", "brand risk"],
  readingTimeMin: 6,
  Content,
};
