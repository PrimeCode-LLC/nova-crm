import type { BlogPost } from "@/lib/blog";

function Content() {
  return (
    <>
      <p>
        Agency owners, consultants, and B2B service founders live a specific
        outbound pain: the work that pays the bills also crowds out the work
        that fills the pipeline. You know how to sell. You do not have a spare
        headcount line every time the list grows.
      </p>
      <p>
        Generic sales advice assumes a sales org. You need outbound designed for{" "}
        <strong>more pipeline than people</strong>.
      </p>

      <h2>What breaks first in service-business outbound</h2>
      <ul>
        <li>Proposals and delivery steal the hours that used to go to follow-up</li>
        <li>Every prospect needs a slightly different proof point (industry, scope, outcome)</li>
        <li>&quot;Blast tools&quot; feel off-brand for high-trust services</li>
        <li>Replies arrive while you are in client work — and cool off before you answer</li>
      </ul>

      <h2>Design the motion around judgement, not volume theatre</h2>
      <ol>
        <li>
          <strong>Load how you actually sell.</strong> Services, ICP,
          disqualifiers, case studies, and phrases you already approve.
        </li>
        <li>
          <strong>Import a list you would be proud to work by hand.</strong>{" "}
          Enrichment helps; spray-and-pray does not.
        </li>
        <li>
          <strong>Let the system run the chase.</strong> Personalised sequences,
          resume dates, and pauses on reply or OOO.
        </li>
        <li>
          <strong>Keep approval on what represents you.</strong> Especially
          early. Loosen later when quality is proven.
        </li>
      </ol>

      <h2>Metrics that matter when you are the sales team</h2>
      <p>
        Vanity open rates will not tell you if the business is healthier. Watch:
      </p>
      <ul>
        <li>Positive reply rate by segment</li>
        <li>Time-to-first-response on warm intent</li>
        <li>Meetings booked per active sequence</li>
        <li>Follow-ups missed (should trend toward zero)</li>
        <li>Claims rejected or edited before send (quality signal)</li>
      </ul>

      <h2>CRM and execution belong together</h2>
      <p>
        Service businesses suffer when the tool that sends email is not the tool
        that owns the deal. Sync drift creates ghost stages and double work.
        Pipeline, contacts, and the outbound engine should share one record of
        truth — so when a prospect says &quot;next quarter,&quot; the resume
        lives on the same object as the deal.
      </p>

      <h2>Nova for service and SaaS owners</h2>
      <p>
        Nova is built for this exact profile: founders running outbound with
        judgement requirements and headcount constraints. It writes from your
        world, handles the follow-up and reply layer, and keeps you on the
        conversations that need a human.
      </p>
      <p>
        If that sounds like your week,{" "}
        <a href="/#waitlist">join the founding cohort waitlist</a>.
      </p>
    </>
  );
}

export const post: BlogPost = {
  slug: "outbound-for-b2b-service-founders",
  title: "Outbound for B2B service founders with more pipeline than people",
  description:
    "Agency and consultancy owners need outbound that protects the brand and never drops follow-ups — without hiring for every list increase.",
  publishedAt: "2026-07-15",
  author: { name: "Nova Team", role: "Product" },
  tags: ["B2B services", "agencies", "outbound"],
  readingTimeMin: 6,
  Content,
};
