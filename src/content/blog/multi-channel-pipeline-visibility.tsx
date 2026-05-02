import type { BlogPost } from "@/lib/blog";

function Content() {
  return (
    <>
      <p>
        Most sales teams don&apos;t lose deals in the closing stage. They lose
        deals in the <em>seams</em> between channels, the lead that came in
        through Upwork, got bumped to email, and then nobody touched it for
        eleven days because it lived nowhere in particular.
      </p>

      <p>
        If your outbound runs across cold email, LinkedIn, Upwork, inbound, and
        1:1 personalization, and you&apos;re managing it in a spreadsheet, you
        already know the problem. Here&apos;s what to actually do about it.
      </p>

      <h2>Channels deserve their own funnels</h2>
      <p>
        A cold email funnel is <code>Sent → Opened → Clicked → Replied →
        Meeting → Closed</code>. An Upwork funnel is{" "}
        <code>Applied → Viewed → Replied → Hired → Revenue</code>. They&apos;re
        not the same shape, and forcing them into the same shape destroys
        diagnostics.
      </p>
      <p>
        Keep each channel&apos;s top-of-funnel <strong>shaped like the
        channel</strong>. Then converge into one shared closing pipeline once a
        lead is qualified. That way your director dashboard can compare channels
        apples-to-apples on the closing side without erasing how each channel
        actually works.
      </p>

      <h2>One lead, multiple touchpoints</h2>
      <p>
        A single lead can be at <code>Email Step 3</code> and{" "}
        <code>LinkedIn Connection Sent</code> simultaneously. Treat per-channel
        state as a separate concept from overall pipeline stage. The lead has
        one stage; it can have many touchpoints.
      </p>

      <h2>Idle alerts beat reports</h2>
      <p>
        Reports tell you what already broke. Idle-lead alerts tell you what is
        breaking right now. Set a per-stage threshold (Replied: 2 days,
        Discovery: 7 days), surface anything past it on the dashboard, and
        you&apos;ll catch decay weeks earlier.
      </p>

      <h2>The diagnostic test</h2>
      <p>
        Here&apos;s the gut check: when closings drop next month, can you tell, in
        ten seconds, whether it&apos;s a work-rate problem, a profile
        problem, a proposal problem, or a closing problem?
      </p>
      <p>
        If you can&apos;t, you&apos;re flying blind. The fix isn&apos;t a bigger
        spreadsheet. It&apos;s a system that tracks effort and intent as
        separate layers, so when one moves and the other doesn&apos;t, the
        cause is obvious.
      </p>
    </>
  );
}

export const post: BlogPost = {
  slug: "multi-channel-pipeline-visibility",
  title: "Why your multi-channel pipeline is invisible (and how to fix it)",
  description:
    "Channels lose deals in the seams. Per-channel funnels, shared closing pipeline, and idle alerts close those gaps.",
  publishedAt: "2026-04-22",
  author: { name: "Nova Team", role: "Product" },
  tags: ["pipeline", "operations", "diagnostics"],
  readingTimeMin: 4,
  Content,
};
