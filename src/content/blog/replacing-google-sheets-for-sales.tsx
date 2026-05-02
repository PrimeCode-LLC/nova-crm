import type { BlogPost } from "@/lib/blog";

function Content() {
  return (
    <>
      <p>
        Every sales team starts in a spreadsheet. It&apos;s the right call:
        spreadsheets are infinitely flexible, free, and don&apos;t require buy-in
        from anyone but you. The problem comes a year later, when six things
        all break at once and the spreadsheet can&apos;t fix any of them.
      </p>

      <h2>What spreadsheets do well</h2>
      <ul>
        <li>Onboarding ramp time: zero.</li>
        <li>Schema flexibility: total.</li>
        <li>Ad-hoc analysis: superb.</li>
        <li>Cross-team collaboration: fine in small numbers.</li>
      </ul>

      <h2>What they fail at, and why migration is hard</h2>
      <p>
        Each of these is solvable individually. None of them is solvable
        without writing code.
      </p>
      <ul>
        <li>
          <strong>Permissions.</strong> A spreadsheet either grants edit access
          or doesn&apos;t. There&apos;s no &quot;junior reps see only their own
          rows.&quot;
        </li>
        <li>
          <strong>Required fields per stage.</strong> Nothing stops someone
          marking a lead Qualified without filling BANT.
        </li>
        <li>
          <strong>Idle detection.</strong> The sheet doesn&apos;t know that
          row 47 hasn&apos;t been touched in 11 days.
        </li>
        <li>
          <strong>Channel-specific funnels.</strong> One sheet can&apos;t hold
          six different funnels without becoming illegible.
        </li>
        <li>
          <strong>Audit trail.</strong> &quot;Who changed this stage?&quot;
          isn&apos;t answerable.
        </li>
        <li>
          <strong>Concurrency.</strong> Two scrapers add the same lead, and
          you have a duplicate forever.
        </li>
      </ul>

      <h2>What the migration looks like</h2>
      <p>
        Done right, a Sheets-to-CRM migration takes one afternoon, not one
        quarter.
      </p>
      <ol>
        <li>
          Export the sheet to CSV. Every column maps to a known CRM field; the
          unknown ones go into a notes blob.
        </li>
        <li>
          Import. The CRM dedupes on email, then LinkedIn URL, then phone.
        </li>
        <li>
          Repoint your existing automations. n8n, Instantly, Apollo, Outlook
          all stay, they just read from the CRM instead of the sheet.
        </li>
        <li>
          Archive the original sheet, read-only, for six months as a backup.
        </li>
      </ol>

      <h2>Keep the spreadsheet escape hatch</h2>
      <p>
        Don&apos;t take Sheets away from people who like Sheets for ad-hoc
        analysis. Make &quot;Export to Sheets&quot; a one-click button on every
        view. The CRM becomes the system of record; the spreadsheet becomes the
        scratchpad.
      </p>

      <p>
        That&apos;s the move that wins the team over. Replace the spreadsheet
        for daily work, but never for analysis. Both jobs deserve the right
        tool.
      </p>
    </>
  );
}

export const post: BlogPost = {
  slug: "replacing-google-sheets-for-sales",
  title: "How to actually replace Google Sheets for a working sales team",
  description:
    "Sheets are a great starting point and a terrible ending point. Here's the migration playbook that doesn't trigger a revolt.",
  publishedAt: "2026-04-08",
  author: { name: "Nova Team", role: "Product" },
  tags: ["migration", "operations", "sheets"],
  readingTimeMin: 6,
  Content,
};
