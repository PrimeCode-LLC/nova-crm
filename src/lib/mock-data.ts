import type {
  User,
  Department,
  Account,
  Contact,
  Lead,
  Deal,
  Touchpoint,
  TimelineEvent,
  Followup,
  LeadTask,
  Note,
  Profile,
  Campaign,
  ActivityCounterRow,
  ActivityRecord,
  PermissionOverride,
  ChannelKey,
  PipelineStage,
  BANT,
  RevenueRange,
  CompanySize,
  LeadTemperature,
  LeadPriority,
  PushStatus,
} from "./types";

function isoDaysAgo(d: number): string {
  const date = new Date();
  date.setDate(date.getDate() - d);
  return date.toISOString();
}

function pick<T>(arr: readonly T[], i: number): T {
  return arr[i % arr.length];
}

// ───────────────────────── Users ─────────────────────────
export const mockUsers: User[] = [
  {
    id: "u-director",
    email: "james.mitchell@nova.co",
    displayName: "James Mitchell",
    roleId: "director",
    orgRole: "owner",
    title: "Founder & Director",
    isSuperAdmin: true,
    status: "active",
    createdAt: isoDaysAgo(720),
  },
  {
    id: "u-mgr-email",
    email: "sarah.chen@nova.co",
    displayName: "Sarah Chen",
    roleId: "manager",
    departmentId: "d-outbound",
    managerId: "u-director",
    title: "Outbound Manager",
    status: "active",
    createdAt: isoDaysAgo(480),
  },
  {
    id: "u-mgr-upwork",
    email: "marcus.webb@nova.co",
    displayName: "Marcus Webb",
    roleId: "manager",
    departmentId: "d-upwork",
    managerId: "u-director",
    title: "Upwork Team Lead",
    status: "active",
    createdAt: isoDaysAgo(420),
  },
  {
    id: "u-sales-01",
    email: "chris.sullivan@nova.co",
    displayName: "Chris Sullivan",
    roleId: "salesperson",
    departmentId: "d-outbound",
    managerId: "u-mgr-email",
    title: "Senior SDR",
    status: "active",
    createdAt: isoDaysAgo(310),
  },
  {
    id: "u-sales-02",
    email: "emma.walsh@nova.co",
    displayName: "Emma Walsh",
    roleId: "salesperson",
    departmentId: "d-outbound",
    managerId: "u-mgr-email",
    title: "SDR",
    status: "active",
    createdAt: isoDaysAgo(220),
  },
  {
    id: "u-sales-03",
    email: "ryan.cooper@nova.co",
    displayName: "Ryan Cooper",
    roleId: "salesperson",
    departmentId: "d-upwork",
    managerId: "u-mgr-upwork",
    title: "Upwork Closer",
    status: "active",
    createdAt: isoDaysAgo(180),
  },
  {
    id: "u-scrape-01",
    email: "laura.bennett@nova.co",
    displayName: "Laura Bennett",
    roleId: "prospecting",
    departmentId: "d-data",
    managerId: "u-mgr-email",
    title: "Data Researcher",
    status: "active",
    createdAt: isoDaysAgo(140),
  },
  {
    id: "u-tl-inbound",
    email: "michael.hayes@nova.co",
    displayName: "Michael Hayes",
    roleId: "team_lead",
    departmentId: "d-inbound",
    managerId: "u-director",
    title: "Inbound Lead",
    status: "active",
    createdAt: isoDaysAgo(380),
  },
];

export const CURRENT_USER_ID = "u-director";

// ───────────────────────── Departments ─────────────────────────
export const mockDepartments: Department[] = [
  { id: "d-outbound", name: "Outbound Sales", description: "Cold email + LinkedIn outbound teams" },
  { id: "d-upwork", name: "Upwork Team", description: "Proposal writers + closers" },
  { id: "d-inbound", name: "Inbound", description: "Website leads + 1:1 followups" },
  { id: "d-data", name: "Data & Research", description: "Scrapers + enrichment" },
];

// ───────────────────────── Permission Overrides ─────────────────────────
export const mockPermissionOverrides: PermissionOverride[] = [
  {
    id: "po-1",
    userId: "u-sales-01",
    resource: "leads",
    action: "read",
    scope: "department",
    scopeDepartmentId: "d-outbound",
    effect: "grant",
    note: "Chris mentors Emma and Ryan; needs to review their leads.",
    createdBy: "u-director",
    createdAt: isoDaysAgo(60),
  },
  {
    id: "po-2",
    userId: "u-sales-02",
    resource: "leads",
    action: "delete",
    scope: "own",
    effect: "deny",
    note: "PIP: can edit but not delete during probation.",
    createdBy: "u-mgr-email",
    createdAt: isoDaysAgo(14),
  },
];

// ───────────────────────── Profiles ─────────────────────────
export const mockProfiles: Profile[] = [
  { id: "p-upwork-main", name: "CompanyMain (Upwork)", channel: "upwork", ownerId: "u-mgr-upwork", active: true },
  { id: "p-upwork-personal", name: "Personal, Upwork (exec)", channel: "upwork", ownerId: "u-director", active: true },
  { id: "p-cv-backend", name: "CV-Backend-v3", channel: "job_apply", ownerId: "u-sales-03", active: true },
  { id: "p-cv-fullstack", name: "CV-Fullstack-v2", channel: "job_apply", ownerId: "u-sales-03", active: true },
  { id: "p-li-primary", name: "Executive, LinkedIn outbound", channel: "linkedin_outbound", ownerId: "u-director", active: true },
];

// ───────────────────────── Campaigns ─────────────────────────
export const mockCampaigns: Campaign[] = [
  {
    id: "c-saas-founders",
    name: "SaaS Founders Q2",
    channel: "cold_email",
    status: "active",
    externalRef: "instantly:camp_8821",
    startedAt: isoDaysAgo(45),
    stats: { sent: 4820, replied: 143, meetings: 27, closed: 4 },
  },
  {
    id: "c-fintech-cto",
    name: "Fintech CTOs",
    channel: "cold_email",
    status: "active",
    externalRef: "instantly:camp_9014",
    startedAt: isoDaysAgo(22),
    stats: { sent: 2410, replied: 71, meetings: 12, closed: 1 },
  },
  {
    id: "c-agency-mkt",
    name: "Agency Marketing Dirs",
    channel: "linkedin_outbound",
    status: "paused",
    startedAt: isoDaysAgo(90),
    stats: { sent: 420, replied: 38, meetings: 9, closed: 2 },
  },
  {
    id: "c-website-q2",
    name: "Website Inbound Q2",
    channel: "website_form",
    status: "active",
    startedAt: isoDaysAgo(80),
    stats: { sent: 0, replied: 112, meetings: 34, closed: 7 },
  },
];

// ───────────────────────── Accounts ─────────────────────────
const accountSeeds = [
  { name: "Northwind Logistics", domain: "northwind.io", industry: "Logistics", size: "201-500" as CompanySize, rev: "50m_100m" as RevenueRange },
  { name: "Sentinel Security", domain: "sentinel.sh", industry: "Cybersecurity", size: "51-200" as CompanySize, rev: "10m_50m" as RevenueRange },
  { name: "Lattice Labs", domain: "latticelabs.ai", industry: "AI / ML", size: "11-50" as CompanySize, rev: "1m_10m" as RevenueRange },
  { name: "Beacon Health", domain: "beaconhealth.com", industry: "Healthcare", size: "501-1000" as CompanySize, rev: "100m_500m" as RevenueRange },
  { name: "Quill Studio", domain: "quill.design", industry: "Design Agency", size: "11-50" as CompanySize, rev: "1m_10m" as RevenueRange },
  { name: "Forge Robotics", domain: "forgerobot.com", industry: "Robotics", size: "51-200" as CompanySize, rev: "10m_50m" as RevenueRange },
  { name: "Meridian Capital", domain: "meridiancap.co", industry: "Finance", size: "201-500" as CompanySize, rev: "100m_500m" as RevenueRange },
  { name: "Orbit Analytics", domain: "orbit.dev", industry: "Data Analytics", size: "11-50" as CompanySize, rev: "1m_10m" as RevenueRange },
  { name: "Kite Commerce", domain: "kite.shop", industry: "E-commerce", size: "51-200" as CompanySize, rev: "10m_50m" as RevenueRange },
  { name: "Aurora Games", domain: "auroragames.gg", industry: "Gaming", size: "201-500" as CompanySize, rev: "50m_100m" as RevenueRange },
  { name: "Harbor Insurance", domain: "harborins.com", industry: "Insurance", size: "1001-5000" as CompanySize, rev: "500m_1b" as RevenueRange },
  { name: "Pixel Foundry", domain: "pixelfoundry.io", industry: "Design Agency", size: "11-50" as CompanySize, rev: "1m_10m" as RevenueRange },
  { name: "Ridge Biotech", domain: "ridgebio.com", industry: "Biotech", size: "51-200" as CompanySize, rev: "10m_50m" as RevenueRange },
  { name: "Vector Pay", domain: "vectorpay.io", industry: "Fintech", size: "51-200" as CompanySize, rev: "10m_50m" as RevenueRange },
  { name: "Summit Cloud", domain: "summitcloud.net", industry: "Cloud Infra", size: "501-1000" as CompanySize, rev: "100m_500m" as RevenueRange },
  { name: "Copper Kitchen", domain: "copperkitchen.co", industry: "D2C Food", size: "51-200" as CompanySize, rev: "10m_50m" as RevenueRange },
  { name: "Nova Learning", domain: "novalearning.org", industry: "EdTech", size: "51-200" as CompanySize, rev: "10m_50m" as RevenueRange },
  { name: "Atlas Freight", domain: "atlasfreight.io", industry: "Logistics", size: "501-1000" as CompanySize, rev: "100m_500m" as RevenueRange },
  { name: "Juniper HR", domain: "juniperhr.com", industry: "HR Tech", size: "11-50" as CompanySize, rev: "1m_10m" as RevenueRange },
  { name: "Maple Media", domain: "maplemedia.tv", industry: "Media", size: "201-500" as CompanySize, rev: "50m_100m" as RevenueRange },
];

export const mockAccounts: Account[] = accountSeeds.map((a, i) => {
  const base: Account = {
    id: `a-${i + 1}`,
    name: a.name,
    domain: a.domain,
    industry: a.industry,
    size: a.size,
    revenueRange: a.rev,
    location: pick(["San Francisco, US", "New York, US", "London, UK", "Berlin, DE", "Singapore", "Toronto, CA", "Dubai, AE"], i),
    yearFounded: 2010 + (i % 12),
    website: `https://${a.domain}`,
    linkedin: `https://linkedin.com/company/${a.domain?.split(".")[0]}`,
    techStack: pick(
      [
        ["Next.js", "Postgres", "AWS"],
        ["React", "Django", "GCP"],
        ["Vue", "Go", "Azure"],
        ["HubSpot", "Salesforce"],
        ["Shopify", "Klaviyo"],
      ],
      i,
    ),
    contactCount: 1 + (i % 4),
    leadCount: 1 + (i % 3),
    openDealValue: i % 3 === 0 ? 12000 + i * 2400 : 0,
    ownerId: pick(["u-sales-01", "u-sales-02", "u-sales-03", "u-tl-inbound"], i),
    createdAt: isoDaysAgo(200 - i * 4),
    updatedAt: isoDaysAgo(i % 30),
  };
  if (i === 0) {
    return {
      ...base,
      businessDescription: "Regional freight visibility and routing platform for mid-market shippers.",
      city: "Austin",
      state: "TX",
      country: "USA",
      location: "Austin, TX, USA",
      yearFounded: 2016,
      businessStatus: "active",
      website: "https://northwind.io",
      websiteStatus: "live",
      onlineActivityScore: "high",
      lastWebsiteActivityNote: "Blog + changelog active weekly",
      careersPageUrl: "https://northwind.io/careers",
    };
  }
  return base;
});

// ───────────────────────── Contacts ─────────────────────────
const firstNames = ["Jordan", "Priya", "Sofia", "Marcus", "Avery", "Ethan", "Lucia", "Noah", "Isabela", "Kenji", "Fiona", "Liam", "Nadia", "Owen", "Mira", "Ross", "Chloe", "Diego", "Amaia", "Kai"];
const lastNames = ["Harper", "Duncan", "Morales", "Chen", "Okoye", "Novak", "Rowe", "Weiss", "Serrano", "Walsh", "Armstrong", "Bennett", "Romero", "Takahashi", "Goldstein", "Porter", "Volkov", "Barnes", "Mason", "Vega"];
const titles = ["CEO", "Founder", "CTO", "VP of Sales", "Head of Growth", "Director of Marketing", "VP Engineering", "Head of Product", "Chief of Staff", "COO"];

export const mockContacts: Contact[] = mockAccounts.flatMap((acc, i) => {
  const count = 1 + (i % 3);
  return Array.from({ length: count }).map((_, j) => {
    const idx = i * 3 + j;
    const first = pick(firstNames, idx);
    const last = pick(lastNames, idx + 3);
    return {
      id: `ct-${acc.id}-${j}`,
      accountId: acc.id,
      firstName: first,
      lastName: last,
      fullName: `${first} ${last}`,
      email: `${first.toLowerCase()}.${last.toLowerCase()}@${acc.domain}`,
      emailVerified: idx % 4 !== 0,
      ...(acc.id === "a-1" && j === 0
        ? {
            personalEmail: "jordan.h.personal@gmail.com",
            emailVerificationStatus: "verified" as const,
            contactSource: "LinkedIn",
            bestContactChannel: "email" as const,
          }
        : {}),
      phone: idx % 3 === 0 ? `+1 415-555-01${(10 + idx).toString().padStart(2, "0")}` : undefined,
      linkedin: `https://linkedin.com/in/${first.toLowerCase()}-${last.toLowerCase()}`,
      title: pick(titles, idx),
      seniority: pick(["C-Level", "VP", "Director", "Head"], idx),
      location: acc.location,
      ownerId: acc.ownerId,
      createdAt: acc.createdAt,
      updatedAt: isoDaysAgo(idx % 20),
    };
  });
});

// ───────────────────────── Leads ─────────────────────────
const channels: ChannelKey[] = ["cold_email", "linkedin_outbound", "personalized_email", "website_form", "upwork", "job_apply", "linkedin_1to1"];
const stages: PipelineStage[] = ["new", "contacted", "replied", "qualified", "discovery", "proposal", "negotiation", "won", "lost"];
const temps: LeadTemperature[] = ["cold", "warm", "hot"];
const prios: LeadPriority[] = ["low", "medium", "high", "urgent"];
const pushes: PushStatus[] = ["not_ready", "ready", "pushed", "do_not_push"];
const triggers = [
  "Raised Series B last week",
  "New VP of Sales hired 9 days ago",
  "Posted on LinkedIn about scaling outbound",
  "Shipped mobile app on Product Hunt",
  "Opened NYC office; hiring SDRs",
  "Mentioned Klaviyo pain in a podcast",
  "ICP match, using HubSpot, no BDRs yet",
];
const owners = ["u-sales-01", "u-sales-02", "u-sales-03", "u-tl-inbound"];

export const mockLeads: Lead[] = (
  mockContacts.slice(0, 40).map((c, i) => {
  const account = mockAccounts.find((a) => a.id === c.accountId)!;
  const channel = pick(channels, i);
  const stage = pick(stages, i + 2);
  const bant: BANT | undefined =
    stage === "qualified" || stage === "discovery" || stage === "proposal" || stage === "negotiation" || stage === "won"
      ? { budget: 2 + (i % 4), authority: 3 + (i % 3), need: 2 + (i % 4), timeline: 1 + (i % 5) }
      : undefined;
  const idleDays = pick([0, 1, 3, 7, 12, 2, 5, 9, 0], i);
  const touches = 1 + (i % 8);

  return {
    id: `l-${i + 1}`,
    accountId: account.id,
    contactId: c.id,
    channel,
    campaignId: channel === "cold_email" ? pick(["c-saas-founders", "c-fintech-cto"], i) : channel === "website_form" ? "c-website-q2" : undefined,
    profileId: channel === "upwork" ? pick(["p-upwork-main", "p-upwork-personal"], i) : channel === "job_apply" ? pick(["p-cv-backend", "p-cv-fullstack"], i) : undefined,
    stage,
    temperature: pick(temps, i),
    priority: pick(prios, i + 1),
    ownerId: pick(owners, i),
    scraperId: i % 5 === 0 ? "u-scrape-01" : undefined,
    intakeKind: i === 0 ? "prospect" : undefined,

    contactName: c.fullName,
    contactTitle: c.title,
    contactEmail: c.email,
    contactLinkedIn: c.linkedin,
    companyName: account.name,
    companyDomain: account.domain,
    companyIndustry: account.industry,
    companySize: account.size,
    revenueRange: account.revenueRange,

    triggerEvent: pick(triggers, i),
    painPoints: "Scaling pipeline generation without adding headcount.",
    businessFocus: "B2B SaaS selling into mid-market and enterprise.",
    hiringSignals: i % 3 === 0 ? "Open SDR role posted 4 days ago." : undefined,
    recentNews: i % 4 === 0 ? "Announced new product launch last week." : undefined,
    psLine: i % 2 === 0 ? "Saw your recent LinkedIn post on outbound efficiency; resonated." : undefined,

    pushToInstantly: channel === "cold_email" ? pick(pushes, i) : undefined,
    pushToLinkedIn: channel === "linkedin_outbound" ? pick(pushes, i + 1) : undefined,
    doNotContact: i === 7,

    bant,
    estimatedValue: stage === "proposal" || stage === "negotiation" || stage === "won" ? 8000 + i * 1400 : undefined,
    expectedCloseDate: stage === "proposal" || stage === "negotiation" ? isoDaysAgo(-20 + (i % 40)) : undefined,

    firstContactAt: isoDaysAgo(20 + (i % 30)),
    lastActivityAt: isoDaysAgo(idleDays),
    responseTimeMinutes: i % 3 === 0 ? 15 + (i % 240) : undefined,
    touches,
    isIdle: idleDays >= 7 && stage !== "won" && stage !== "lost",
    idleDays,

    notes: i % 4 === 0 ? "Waiting on their compliance team to approve pilot." : undefined,
    nextAction: i % 3 === 0 ? "Send proposal deck by Friday" : "Follow up on LinkedIn",

    createdAt: isoDaysAgo(60 - i),
    updatedAt: isoDaysAgo(idleDays),
  };
  }) as Lead[]
).map((row, i): Lead =>
  i === 1 ? { ...row, ownerId: "", intakeKind: "prospect", createdById: "u-director" } : row,
);

// ───────────────────────── Deals ─────────────────────────
export const mockDeals: Deal[] = mockLeads
  .filter((l) => ["qualified", "discovery", "proposal", "negotiation", "won", "lost"].includes(l.stage))
  .map((l, i) => ({
    id: `d-${i + 1}`,
    leadId: l.id,
    accountId: l.accountId,
    contactId: l.contactId,
    name: `${l.companyName}: SaaS Subscription`,
    stage: l.stage,
    value: l.estimatedValue ?? 10000 + i * 2500,
    currency: "USD",
    probability:
      l.stage === "won" ? 100 : l.stage === "lost" ? 0 : l.stage === "negotiation" ? 70 : l.stage === "proposal" ? 50 : 25,
    expectedCloseDate: l.expectedCloseDate ?? isoDaysAgo(-30 + (i % 40)),
    ownerId: l.ownerId,
    products: ["Core Platform", "Support"],
    createdAt: l.createdAt,
    updatedAt: l.updatedAt,
    wonAt: l.stage === "won" ? isoDaysAgo(i % 30) : undefined,
    lostAt: l.stage === "lost" ? isoDaysAgo(i % 30) : undefined,
    lostReason: l.stage === "lost" ? "Budget frozen" : undefined,
  }));

// ───────────────────────── Touchpoints ─────────────────────────
export const mockTouchpoints: Touchpoint[] = mockLeads.flatMap((l, i) => {
  const points: Touchpoint[] = [];
  if (l.channel === "cold_email" || l.channel === "personalized_email") {
    for (let s = 1; s <= Math.min(4, 1 + (i % 4)); s++) {
      points.push({
        id: `tp-${l.id}-e${s}`,
        leadId: l.id,
        channel: l.channel,
        state: `email_step_${s}`,
        stepNumber: s,
        occurredAt: isoDaysAgo(20 - s * 3 + (i % 5)),
        summary: s === 1 ? "Initial send" : `Follow-up ${s - 1}`,
      });
    }
  }
  if (l.channel === "linkedin_outbound") {
    points.push({
      id: `tp-${l.id}-li1`,
      leadId: l.id,
      channel: "linkedin_outbound",
      state: "connection_sent",
      occurredAt: isoDaysAgo(14),
      summary: "Connection request sent",
    });
    if (i % 2 === 0)
      points.push({
        id: `tp-${l.id}-li2`,
        leadId: l.id,
        channel: "linkedin_outbound",
        state: "accepted",
        occurredAt: isoDaysAgo(10),
        summary: "Connection accepted",
      });
  }
  return points;
});

// ───────────────────────── Timeline ─────────────────────────
export const mockTimelineByLead: Record<string, TimelineEvent[]> = Object.fromEntries(
  mockLeads.slice(0, 12).map((l, i) => [
    l.id,
    [
      {
        id: `te-${l.id}-1`,
        leadId: l.id,
        type: "lead_created",
        actorId: l.scraperId || l.ownerId,
        summary: `Lead created via ${l.channel.replace("_", " ")}`,
        createdAt: l.createdAt,
      },
      {
        id: `te-${l.id}-2`,
        leadId: l.id,
        type: "email_sent",
        actorId: l.ownerId,
        summary: `Outbound email sent (Step 1)`,
        createdAt: isoDaysAgo(18 - i),
      },
      {
        id: `te-${l.id}-3`,
        leadId: l.id,
        type: "email_replied",
        actorId: l.ownerId,
        summary: `Reply received: positive, wants demo next week`,
        createdAt: isoDaysAgo(12 - (i % 5)),
      },
      {
        id: `te-${l.id}-4`,
        leadId: l.id,
        type: "stage_changed",
        actorId: l.ownerId,
        summary: `Moved from Replied → Qualified`,
        createdAt: isoDaysAgo(10 - (i % 4)),
      },
      {
        id: `te-${l.id}-5`,
        leadId: l.id,
        type: "note_added",
        actorId: l.ownerId,
        summary: `Added note: "Budget confirmed at $25k ACV"`,
        createdAt: isoDaysAgo(6),
      },
    ],
  ]),
);

// ───────────────────────── Followups ─────────────────────────
export const mockFollowups: Followup[] = mockLeads.slice(0, 15).map((l, i) => ({
  id: `f-${i + 1}`,
  leadId: l.id,
  title: i % 2 === 0 ? `Follow up with ${l.contactName}` : `Send proposal to ${l.contactName}`,
  description: l.nextAction,
  dueAt: isoDaysAgo(-1 * (i % 7)),
  completedAt: i % 5 === 0 ? isoDaysAgo(i % 10) : undefined,
  ownerId: l.ownerId,
  priority: l.priority,
  auto: i % 3 === 0,
}));

const L1 = mockLeads[0]!;
const L2 = mockLeads[1]!;

/** Cross-team requests (review, email, etc.) — scoped in `workspace-dataset` per persona. */
export const mockLeadTasks: LeadTask[] = [
  {
    id: "lt-1",
    leadId: L1.id,
    title: "Review outbound email before send",
    description: "Please sanity-check enterprise pricing wording.",
    taskType: "review",
    visibility: "on_lead",
    assigneeId: "u-director",
    createdById: "u-sales-01",
    dueAt: isoDaysAgo(-1),
    createdAt: isoDaysAgo(2),
    contextCompany: L1.companyName,
    contextContact: L1.contactName,
  },
  {
    id: "lt-2",
    leadId: L2.id,
    title: "Draft founder intro for mutual LinkedIn contact",
    taskType: "email",
    visibility: "assignees_only",
    assigneeId: "u-mgr-email",
    createdById: "u-sales-02",
    dueAt: isoDaysAgo(0),
    createdAt: isoDaysAgo(1),
    contextCompany: L2.companyName,
    contextContact: L2.contactName,
  },
  {
    id: "lt-3",
    title: "Approve discount band for Q2 outbound experiment",
    description: "No lead — ops decision.",
    taskType: "other",
    visibility: "assignees_only",
    assigneeId: "u-director",
    createdById: "u-mgr-email",
    dueAt: isoDaysAgo(-2),
    createdAt: isoDaysAgo(5),
  },
];

// ───────────────────────── Notes ─────────────────────────
export const mockNotes: Note[] = mockLeads.slice(0, 8).flatMap((l, i) => [
  {
    id: `n-${l.id}-1`,
    leadId: l.id,
    authorId: l.ownerId,
    body: `Spoke with ${l.contactName} briefly on a discovery call. They're evaluating 3 vendors and want pricing by end of week.`,
    createdAt: isoDaysAgo(5 + (i % 7)),
    pinned: i === 0,
  },
  {
    id: `n-${l.id}-2`,
    leadId: l.id,
    authorId: l.ownerId,
    body: `Key objection: they're worried about migration effort from their current CRM.`,
    createdAt: isoDaysAgo(2 + (i % 4)),
  },
]);

// ───────────────────────── Activity ─────────────────────────
export const mockActivityCounters: ActivityCounterRow[] = Array.from({ length: 21 }).map((_, i) => {
  let counters: Record<string, number>;
  if (i % 3 === 0) {
    counters = { applies_sent: 10 + (i % 15), viewed: 2 + (i % 6), replied: i % 4, hired: i % 12 === 0 ? 1 : 0 };
  } else if (i % 3 === 1) {
    counters = { sent: 80 + i * 4, opened: 20 + i, clicked: 4 + (i % 4), replied: i % 5 };
  } else {
    counters = { connection_sent: 20, accepted: 6, messaged: 4, replied: 1 };
  }
  return {
    id: `ac-${i}`,
    userId: pick(owners, i),
    channel: pick(channels, i),
    profileId: i % 3 === 0 ? "p-upwork-main" : undefined,
    date: isoDaysAgo(i),
    counters,
  };
});

export const mockActivityRecords: ActivityRecord[] = Array.from({ length: 15 }).map((_, i) => ({
  id: `ar-${i}`,
  userId: pick(owners, i),
  channel: pick(["upwork", "personalized_email", "linkedin_1to1"] as ChannelKey[], i),
  profileId: i % 2 === 0 ? "p-upwork-main" : "p-upwork-personal",
  leadId: mockLeads[i % mockLeads.length]?.id,
  type: i % 3 === 0 ? "upwork_apply" : i % 3 === 1 ? "1to1_email" : "linkedin_message",
  occurredAt: isoDaysAgo(i % 10),
  summary: i % 3 === 0 ? "Submitted proposal on data pipeline project" : i % 3 === 1 ? "Sent personalized email" : "DM'd on LinkedIn",
}));

// ───────────────────────── Aggregate helpers ─────────────────────────
export function getLeadById(id: string): Lead | undefined {
  return mockLeads.find((l) => l.id === id);
}

export function getContactById(id: string): Contact | undefined {
  return mockContacts.find((c) => c.id === id);
}

export function getAccountById(id: string): Account | undefined {
  return mockAccounts.find((a) => a.id === id);
}

export function getUserById(id: string): User | undefined {
  return mockUsers.find((u) => u.id === id);
}

export function getProfileById(id?: string): Profile | undefined {
  if (!id) return undefined;
  return mockProfiles.find((p) => p.id === id);
}

export function getCampaignById(id?: string): Campaign | undefined {
  if (!id) return undefined;
  return mockCampaigns.find((c) => c.id === id);
}
