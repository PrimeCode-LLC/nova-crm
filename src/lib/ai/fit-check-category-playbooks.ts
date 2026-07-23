import type { OpportunitySourceType } from "@/lib/ai/opportunity-fit-types";

/** Small category playbooks - indexed once per category; avoids duplicating the global website crawl. */
export function fitCheckCategoryPlaybook(
  category: OpportunitySourceType,
): { title: string; content: string } {
  const common = `
## How to score (all categories)
- Match services, stack, budget band, and timeline to our global company profile.
- "Pass" when stack/budget/geo are clear mismatches; "Maybe" when info is missing; "Pursue" when ICP + economics align.
`;

  const playbooks: Record<OpportunitySourceType, { title: string; body: string }> = {
    job_apply: {
      title: "Fit playbook, Job / application",
      body: `${common}
## Job / application signals
**Strong fit:** Full-time or contract roles mentioning .NET, React, Node, AWS, IoT, legacy modernization, enterprise portals, logistics, or HIPAA-aware systems.
**Weak fit:** Junior-only roles far below our rate band; stacks we do not deliver (e.g. WordPress-only maintenance); on-site-only with no remote when geo excluded.
**Ask in outreach:** Team structure, budget band, contract vs FTE, migration vs greenfield.
**Red flags:** Unpaid trials, vague JD with no budget, "equity only" for enterprise scope.`,
    },
    upwork: {
      title: "Fit playbook, Upwork / freelance",
      body: `${common}
## Upwork / freelance signals
**Strong fit:** Fixed-price or hourly with clear scope; client history and spend; enterprise or funded startup; stack matches (.NET/React/Node/mobile).
**Weak fit:** Race-to-bottom hourly; unrealistic fixed price for scope; no client reviews; copy-paste generic posts.
**Economics:** Our target ~$25–40/hr, below that on platform often "Maybe" at best unless strategic logo.
**Win angle:** De-risk delivery, phased milestones, proof from Fortune 500 / device-management case studies.`,
    },
    rfp: {
      title: "Fit playbook, RFP / tender",
      body: `${common}
## RFP / tender signals
**Strong fit:** Multi-phase enterprise scope, integration, security/compliance requirements, .NET/cloud/mobile, logistics or IoT.
**Weak fit:** Mandatory on-site only in excluded regions; incumbent-only criteria; budget ceiling below minimum viable team.
**Process:** Estimate bid effort vs win probability, pass when bid cost > expected value.
**Emphasize:** Zero-downtime migration, multi-tenant, SignalR/real-time, dedicated team model, IP ownership day one.`,
    },
    inbound: {
      title: "Fit playbook, Inbound email",
      body: `${common}
## Inbound email signals
**Strong fit:** Referral or site visitor with specific pain (legacy system, IoT portal, dispatch platform); budget/timeline mentioned; decision-maker tone.
**Weak fit:** Generic "need an app" with no context; reseller spam; requests outside services.
**Speed:** High intent, prioritize Pursue when ICP match; respond with one hook from global case studies.
**Qualify:** Company size, current stack, decision timeline, budget range.`,
    },
    cold_outbound: {
      title: "Fit playbook, Cold outreach reply",
      body: `${common}
## Cold outreach reply signals
**Strong fit:** Positive reply to our outbound; asks for call or proposal; references our case study or service page.
**Weak fit:** "Not interested" / unsubscribe; auto-reply only; wrong person with no redirect.
**Note:** Fit is often high if they engaged, focus on timing and next step, not re-scoring ICP from scratch.`,
    },
    other: {
      title: "Fit playbook, Other opportunities",
      body: `${common}
## General opportunity signals
Use global ICP and services docs as primary reference.
Score conservatively when channel is unknown, prefer "Maybe" until budget and stack are clear.`,
    },
  };

  const p = playbooks[category];
  return {
    title: p.title,
    content: p.body.trim(),
  };
}
