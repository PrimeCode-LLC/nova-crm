/**
 * Concept-aware lexical matching for Intent Playbook keywords.
 *
 * The original matcher used `haystack.includes(keyword)`, which required research
 * text to contain a playbook phrase verbatim. Real research is written freely, so
 * exact phrases almost never appear and strong prospects scored 0.
 *
 * This module normalizes text into a set of "concepts" (tokens after stemming +
 * a small synonym map) and matches a keyword when enough of its concepts co-occur
 * in the corpus. It stays free, instant, deterministic and explainable — no AI.
 */

const STOPWORDS = new Set([
  "a", "an", "and", "or", "the", "to", "of", "for", "with", "in", "on", "at",
  "by", "from", "as", "is", "are", "be", "we", "our", "their", "your", "that",
  "this", "these", "those", "into", "via", "per", "new", "also", "their",
]);

/**
 * Surface form → canonical concept. Explicit forms are more reliable than a
 * stemmer for cross-vocabulary matches (e.g. developer ↔ engineer). Keep this
 * focused on vocabulary that appears in playbook keywords + typical research.
 */
const SYNONYM_GROUPS: Record<string, string[]> = {
  dev: [
    "developer", "developers", "development", "develop", "developing", "dev", "devs",
    "engineer", "engineers", "engineering", "programmer", "programmers", "coder", "coders",
    "swe", "sde",
  ],
  hire: [
    "hire", "hires", "hiring", "hired", "recruit", "recruits", "recruiting", "recruiter",
    "recruitment", "headcount", "opening", "openings", "vacancy", "vacancies", "staffing",
  ],
  team: ["team", "teams", "org", "organization", "organisation", "workforce", "personnel"],
  scale: ["scale", "scaling", "scalability", "scalable", "grow", "growing", "growth"],
  cloud: ["cloud", "cloud-native", "cloudnative", "hyperscaler", "hyperscalers"],
  migrate: ["migrate", "migration", "migrations", "migrating", "replatform", "replatforming", "rehost"],
  modern: ["modernize", "modernise", "modernization", "modernisation", "modernizing", "modern", "rearchitect", "rearchitecture", "revamp"],
  legacy: ["legacy", "outdated", "aging", "ageing", "obsolete", "antiquated", "old"],
  integrate: ["integrate", "integration", "integrations", "integrating", "integrated", "interoperability", "interoperate", "connect", "connected", "connecting", "unify", "unified", "unifying"],
  api: ["api", "apis"],
  automate: ["automate", "automation", "automations", "automating", "automated", "rpa"],
  workflow: ["workflow", "workflows", "process", "processes"],
  ai: ["ai", "a.i", "artificial", "genai", "gen-ai", "llm", "llms", "gpt"],
  agent: ["agent", "agents", "agentic"],
  ml: ["ml", "machine-learning", "inference", "training"],
  rag: ["rag", "retrieval-augmented", "retrieval"],
  data: ["data", "database", "databases", "datasets", "dataset"],
  silo: ["silo", "silos", "siloed", "disjointed", "disjoint", "fragmented", "fragment", "fragmentation", "disconnected", "disparate"],
  manual: ["manual", "manually", "rekey", "rekeying", "spreadsheet", "spreadsheets", "duplicate", "duplication"],
  platform: ["platform", "platforms", "system", "systems", "application", "applications", "app", "apps", "software", "solution", "solutions"],
  portal: ["portal", "portals"],
  erp: ["erp", "netsuite", "sap"],
  crm: ["crm", "salesforce"],
  saas: ["saas", "multi-tenant", "multitenant", "subscription"],
  mobile: ["mobile", "ios", "android", "flutter"],
  iot: ["iot", "telemetry", "mqtt", "firmware", "sensor", "sensors"],
  device: ["device", "devices", "hardware"],
  rfid: ["rfid", "barcode"],
  tracking: ["tracking", "track", "traceability", "trace", "visibility"],
  inventory: ["inventory", "stock"],
  warehouse: ["warehouse", "warehousing", "fulfillment", "fulfilment"],
  logistics: ["logistics", "shipment", "shipments", "shipping", "dispatch", "freight"],
  fleet: ["fleet", "fleets", "driver", "drivers"],
  healthcare: ["healthcare", "medical", "clinical", "patient", "ehr", "emr", "telehealth", "hipaa"],
  compliance: ["compliance", "compliant", "regulatory", "audit", "soc2", "gdpr", "hipaa"],
  security: ["security", "cybersecurity", "secure", "vulnerability", "vulnerabilities"],
  devops: ["devops", "cicd", "ci/cd", "pipeline", "pipelines", "sre"],
  container: ["container", "containers", "containerize", "containerization", "docker", "kubernetes", "k8s"],
  observability: ["observability", "monitoring", "tracing", "telemetry"],
  performance: ["performance", "latency", "throughput", "bottleneck", "bottlenecks", "slow"],
  reliability: ["reliability", "reliable", "downtime", "outage", "outages", "failure", "failures", "stability", "unstable", "fragile"],
  cost: ["cost", "costs", "expenditure", "expensive", "margin", "margins", "tco"],
  acquire: ["acquire", "acquired", "acquisition", "acquisitions", "merger", "merge", "buyout", "ownership"],
  funding: ["funding", "funded", "investment", "invest", "raised", "series", "equity", "capital"],
  expansion: ["expansion", "expand", "expanding", "facility", "facilities"],
  leader: ["cio", "cto", "cdo", "vp", "chief"],
  website: ["website", "web", "webpage", "site", "ecommerce", "e-commerce"],
  redesign: ["redesign", "rebuild", "revamp", "relaunch"],
  partner: ["partner", "partners", "partnership", "vendor", "vendors", "outsource", "outsourced", "outsourcing", "nearshore", "offshore"],
  rfp: ["rfp", "rfq", "tender", "procurement"],
  augment: ["augment", "augmentation", "staff-augmentation"],
  build: ["build", "building", "built", "develop", "create", "creating"],
  enterprise: ["enterprise", "b2b", "corporate"],
  custom: ["custom", "bespoke", "tailored"],
};

/**
 * Anchor concepts are specific enough that their presence meaningfully implies a
 * signal (e.g. "integration", "acquisition", "kubernetes"). Weak/generic concepts
 * (dev, platform, team, scale, data…) can support a match but never trigger one on
 * their own — this is what stops "builds a platform with engineers" from firing
 * every demand signal.
 */
const ANCHOR_CONCEPTS = new Set<string>([
  "hire", "migrate", "modern", "legacy", "integrate", "api", "automate", "ai",
  "agent", "ml", "rag", "silo", "manual", "iot", "device", "rfid", "tracking",
  "inventory", "warehouse", "logistics", "fleet", "healthcare", "compliance",
  "security", "devops", "container", "observability", "performance", "reliability",
  "acquire", "funding", "expansion", "leader", "website", "redesign", "partner",
  "rfp", "augment", "salesforce", "erp", "crm", "saas", "mobile", "portal", "cloud",
]);

/**
 * Weak anchors are commonly used as background/foil words (e.g. "legacy hyperscaler
 * clouds", "AI-native", "cloud platform"). On their own they cause false positives,
 * so a keyword whose only present anchors are weak needs a second anchor to fire.
 */
const WEAK_ANCHORS = new Set<string>([
  "legacy", "cloud", "ai", "migrate", "modern", "security", "performance",
  "reliability", "api", "ml", "device", "tracking", "container",
]);

const SURFACE_TO_CONCEPT: Map<string, string> = (() => {
  const m = new Map<string, string>();
  for (const [concept, forms] of Object.entries(SYNONYM_GROUPS)) {
    m.set(concept, concept);
    for (const form of forms) m.set(form, concept);
  }
  return m;
})();

/** Light suffix stripper for words not covered by the synonym table. */
function stem(token: string): string {
  let s = token;
  s = s.replace(/'s$/, "");
  if (s.length > 4) {
    s = s.replace(/(izations|ization|isations|isation|ations|ation|ings|ing|ers|ements|ement| ments|ment|ies|ied|es|s)$/, "");
  }
  return s;
}

/** Keep alphanumerics plus tech-token chars (. # +) so ".net", "c#", "c++" survive. */
function rawTokens(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9.#+]+/g)
    .map((t) => t.replace(/^[.#+]+|[.#+]+$/g, ""))
    .filter((t) => t.length > 0);
}

function conceptOf(token: string): string {
  return SURFACE_TO_CONCEPT.get(token) ?? SURFACE_TO_CONCEPT.get(stem(token)) ?? stem(token);
}

/** All concepts present in a corpus (research text). */
export function corpusConcepts(text: string): Set<string> {
  const set = new Set<string>();
  for (const tok of rawTokens(text)) {
    if (STOPWORDS.has(tok)) continue;
    set.add(tok);
    set.add(conceptOf(tok));
  }
  return set;
}

/** Distinct, meaningful concepts a keyword requires. */
function keywordConcepts(keyword: string): string[] {
  const out = new Set<string>();
  for (const tok of rawTokens(keyword)) {
    if (STOPWORDS.has(tok)) continue;
    out.add(conceptOf(tok));
  }
  return [...out];
}

/**
 * True when the keyword matches the corpus.
 * - Exact substring is a fast, zero-false-positive path (preserves curated phrases & tech tokens).
 * - Otherwise the keyword must have at least one anchor concept, ALL of its anchor
 *   concepts must be present, and total concept coverage must reach ~60%. Keywords
 *   made only of generic concepts fall back to exact-substring (no fuzzy match), so
 *   vague phrases like "new business platform" can't fire on incidental words.
 */
export function keywordMatchesCorpus(
  corpusRaw: string,
  concepts: Set<string>,
  keyword: string,
): boolean {
  const kw = keyword.trim().toLowerCase();
  if (!kw) return false;
  if (corpusRaw.includes(kw)) return true;

  const kwConcepts = keywordConcepts(kw);
  const n = kwConcepts.length;
  if (n === 0) return false;

  const anchors = kwConcepts.filter((c) => ANCHOR_CONCEPTS.has(c));
  if (anchors.length === 0) return false;
  if (!anchors.every((c) => concepts.has(c))) return false;

  // Guard against foil words: a lone weak anchor (legacy/cloud/ai…) can't trigger.
  const strongPresent = anchors.some((c) => !WEAK_ANCHORS.has(c));
  if (!strongPresent && anchors.length < 2) return false;

  const required = Math.max(anchors.length, Math.ceil(n * 0.6));
  const hits = kwConcepts.filter((c) => concepts.has(c)).length;
  return hits >= Math.min(required, n);
}

/** Returns the first keyword that matches, else undefined (for match reasons). */
export function firstMatchingKeyword(
  corpusRaw: string,
  concepts: Set<string>,
  keywords: string[],
): string | undefined {
  return keywords.find((kw) => keywordMatchesCorpus(corpusRaw, concepts, kw));
}
