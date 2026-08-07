import type { BlogPost } from "@/lib/blog";

function Content() {
  return (
    <>
      <p>
        &quot;Should we hire an SDR or buy an AI SDR?&quot; is the wrong framing.
        You are deciding how to cover outbound capacity: writing, chasing,
        reading replies, and protecting the brand — with a budget and a risk
        tolerance attached.
      </p>
      <p>
        Here is a founder-friendly way to choose without dogma.
      </p>

      <h2>What you are actually buying in each case</h2>
      <p>
        <strong>A human SDR</strong> buys judgement, relationship nuance, and
        calendar coordination — plus ramp time, management overhead, and
        variance by person. They still need lists, messaging, coaching, and a
        system that does not drop follow-ups.
      </p>
      <p>
        <strong>An AI outbound system</strong> buys consistent execution at
        volume: personalised plans, follow-ups that do not slip, reply triage,
        and drafts ready for approval. It does not replace the founder on
        complex deals. It removes the busywork that keeps you from those deals.
      </p>

      <h2>Choose a human SDR when…</h2>
      <ul>
        <li>Enterprise cycles need multi-threaded relationship work from day one</li>
        <li>You already have a proven playbook and someone to coach daily</li>
        <li>Phone-heavy or event-heavy motions dominate over email</li>
        <li>You can afford 3–6 months of ramp before reliable output</li>
      </ul>

      <h2>Choose AI-led outbound when…</h2>
      <ul>
        <li>You have more qualified pipeline than people to work it</li>
        <li>Email (and light multi-touch) is the primary motion</li>
        <li>Follow-ups and reply lag are visibly killing conversion</li>
        <li>You need brand-safe automation with approval gates, not unsupervised blasts</li>
        <li>Hiring another seat would mostly recreate writing and chasing you already understand</li>
      </ul>

      <h2>The hybrid that usually wins</h2>
      <p>
        Many teams should not pick a pure side. Use AI to run the journey and
        first-pass replies; keep humans on high-intent threads, pricing
        negotiations, and closing. That hybrid is how you scale meetings without
        scaling headcount one-for-one with list size.
      </p>

      <h2>Cost is more than salary vs software</h2>
      <p>
        Compare fully loaded cost of missed follow-ups, slow reply SLAs, and
        brand damage from bad AI copy — not sticker price alone. A cheap tool
        that invents claims is expensive. A hire without a system becomes a
        spreadsheet with a LinkedIn login.
      </p>

      <h2>Where Nova sits</h2>
      <p>
        Nova is for B2B service and SaaS owners who want autonomous outbound
        with a handbrake: grounded messages, journey rewrites, reply drafts, and
        human approval. It is CRM plus execution in one place — so the system
        that books the meeting is the system that remembers the deal.
      </p>
      <p>
        Still weighing hire vs system?{" "}
        <a href="/#waitlist">Tell us your motion on the waitlist</a> and we will
        be honest about fit.
      </p>
    </>
  );
}

export const post: BlogPost = {
  slug: "ai-sdr-vs-hiring-an-sdr",
  title: "AI SDR vs hiring an SDR: a decision framework for founders",
  description:
    "Stop treating AI SDR vs hire as ideology. Compare capacity, ramp, brand risk, and when a hybrid outbound system wins.",
  publishedAt: "2026-07-22",
  author: { name: "Nova Team", role: "Product" },
  tags: ["AI SDR", "hiring", "founders"],
  readingTimeMin: 6,
  Content,
};
