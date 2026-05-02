import type { BlogPost } from "@/lib/blog";

function Content() {
  return (
    <>
      <p>
        Most CRMs only track one thing: leads. That&apos;s a problem, because
        leads are a <em>result</em>. The thing that creates those leads is{" "}
        <em>effort</em>, and it usually lives somewhere else, often a separate
        spreadsheet that&apos;s out-of-date.
      </p>
      <p>
        When the two are tracked separately, you can&apos;t answer the most
        important sales question of the month: <strong>why did closings
        change?</strong>
      </p>

      <h2>Two layers, by design</h2>
      <p>
        We track two distinct things, and we keep them distinct on purpose:
      </p>
      <ul>
        <li>
          <strong>Activity layer:</strong> daily counts per person, per channel.
          How many emails sent, connections requested, Upwork applications,
          forms filled. No individual records here, just numbers.
        </li>
        <li>
          <strong>Lead &amp; deal layer:</strong> real records with full
          context. Owner, stage, notes, followups, BANT scoring,
          timeline.
        </li>
      </ul>

      <h2>The diagnostic chain</h2>
      <p>
        Once you have both layers, every drop in closings has a precise cause:
      </p>
      <ul>
        <li>
          <strong>Fewer applies →</strong> work-rate problem. Push harder, hire
          more.
        </li>
        <li>
          <strong>Same applies, fewer views →</strong> profile problem. Rewrite
          the profile.
        </li>
        <li>
          <strong>Same views, fewer replies →</strong> proposal problem. Better
          cover letters.
        </li>
        <li>
          <strong>Same replies, fewer closes →</strong> sales-skill problem.
          Better follow-up, pricing, and closing.
        </li>
      </ul>

      <p>
        Without the activity layer, all four look identical: closings down. With
        it, the cause is unambiguous, and so is the fix.
      </p>

      <h2>Why this isn&apos;t standard</h2>
      <p>
        Activity tracking feels like &quot;more data entry,&quot; which CRM
        vendors avoid. But it isn&apos;t, a daily rollup form takes 30 seconds.
        And the diagnostic value of the data is overwhelming compared to the
        cost.
      </p>
      <p>
        If you only take one structural idea from how we built Nova: split
        effort and intent. Every reporting question becomes easier the moment
        you do.
      </p>
    </>
  );
}

export const post: BlogPost = {
  slug: "two-layer-tracking-model",
  title: "The two-layer tracking model: why effort and intent must live apart",
  description:
    "Most CRMs only track leads. The activity layer, what your team did to create those leads, is what makes diagnostics actually possible.",
  publishedAt: "2026-04-15",
  author: { name: "Nova Team", role: "Product" },
  tags: ["operations", "diagnostics", "metrics"],
  readingTimeMin: 5,
  Content,
};
