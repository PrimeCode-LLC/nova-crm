const STOPWORDS = new Set([
  "a", "an", "and", "or", "the", "to", "of", "for", "with", "in", "on", "at",
  "by", "from", "as", "is", "are", "be", "we", "our", "their", "your", "that",
  "this", "these", "those", "into", "via", "per", "new", "also",
]);

const SYNONYM_GROUPS: Record<string, string[]> = {
  dev: ["developer", "developers", "development", "develop", "developing", "dev", "devs", "engineer", "engineers", "engineering", "programmer", "programmers", "coder", "coders", "swe", "sde"],
  hire: ["hire", "hires", "hiring", "hired", "recruit", "recruits", "recruiting", "recruiter", "recruitment", "headcount", "opening", "openings", "vacancy", "vacancies", "staffing"],
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
  // Do not map bare "series" → funding ("TV Series" must not match "series a funding").
  funding: [
    "funding",
    "funded",
    "investment",
    "invest",
    "raised",
    "series-a",
    "series-b",
    "series-c",
    "series-d",
    "equity",
    "capital",
  ],
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

const ANCHOR_CONCEPTS = new Set([
  "hire", "migrate", "modern", "legacy", "integrate", "api", "automate", "ai",
  "agent", "ml", "rag", "silo", "manual", "iot", "device", "rfid", "tracking",
  "inventory", "warehouse", "logistics", "fleet", "healthcare", "compliance",
  "security", "devops", "container", "observability", "performance", "reliability",
  "acquire", "funding", "expansion", "leader", "website", "redesign", "partner",
  "rfp", "augment", "salesforce", "erp", "crm", "saas", "mobile", "portal", "cloud",
]);

const WEAK_ANCHORS = new Set([
  "legacy", "cloud", "ai", "migrate", "modern", "security", "performance",
  "reliability", "api", "ml", "device", "tracking", "container",
]);

const SURFACE_TO_CONCEPT = new Map<string, string>();
for (const [concept, forms] of Object.entries(SYNONYM_GROUPS)) {
  SURFACE_TO_CONCEPT.set(concept, concept);
  for (const form of forms) SURFACE_TO_CONCEPT.set(form, concept);
}

function stem(token: string): string {
  let value = token.replace(/'s$/, "");
  if (value.length > 4) {
    value = value.replace(/(izations|ization|isations|isation|ations|ation|ings|ing|ers|ements|ement|ments|ment|ies|ied|es|s)$/, "");
  }
  return value;
}

function rawTokens(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9.#+]+/g)
    .map((token) => token.replace(/^[.#+]+|[.#+]+$/g, ""))
    .filter(Boolean);
}

function conceptOf(token: string): string {
  return SURFACE_TO_CONCEPT.get(token) ?? SURFACE_TO_CONCEPT.get(stem(token)) ?? stem(token);
}

export function corpusConcepts(text: string): Set<string> {
  const concepts = new Set<string>();
  for (const token of rawTokens(text)) {
    if (STOPWORDS.has(token)) continue;
    concepts.add(token);
    concepts.add(conceptOf(token));
  }
  return concepts;
}

function keywordConcepts(keyword: string): string[] {
  const concepts = new Set<string>();
  for (const token of rawTokens(keyword)) {
    if (!STOPWORDS.has(token)) concepts.add(conceptOf(token));
  }
  return [...concepts];
}

export function keywordMatchesCorpus(
  corpusRaw: string,
  concepts: Set<string>,
  keyword: string,
): boolean {
  const normalized = keyword.trim().toLowerCase();
  if (!normalized) return false;
  if (corpusRaw.includes(normalized)) return true;
  const requiredConcepts = keywordConcepts(normalized);
  if (!requiredConcepts.length) return false;
  const anchors = requiredConcepts.filter((concept) => ANCHOR_CONCEPTS.has(concept));
  if (!anchors.length || !anchors.every((concept) => concepts.has(concept))) return false;
  const strongPresent = anchors.some((concept) => !WEAK_ANCHORS.has(concept));
  if (!strongPresent && anchors.length < 2) return false;
  const required = Math.max(anchors.length, Math.ceil(requiredConcepts.length * 0.6));
  const hits = requiredConcepts.filter((concept) => concepts.has(concept)).length;
  return hits >= Math.min(required, requiredConcepts.length);
}

export function firstMatchingKeyword(
  corpusRaw: string,
  concepts: Set<string>,
  keywords: string[],
): string | undefined {
  return keywords.find((keyword) => keywordMatchesCorpus(corpusRaw, concepts, keyword));
}

export type TextBlock = {
  id: string;
  text: string;
  start?: number;
};

export type MatchEvidence = {
  blockId: string;
  excerpt: string;
  keyword: string;
  matchType: "exact" | "conceptual";
  surfaceTerms: string[];
  ranges: { start: number; end: number }[];
};

function excerptAround(text: string, start: number, end: number): string {
  const from = Math.max(0, start - 100);
  const to = Math.min(text.length, end + 180);
  return `${from > 0 ? "…" : ""}${text.slice(from, to).trim()}${to < text.length ? "…" : ""}`;
}

export function findKeywordEvidence(blocks: readonly TextBlock[], keyword: string): MatchEvidence | undefined {
  const normalizedKeyword = keyword.trim().toLowerCase();
  for (const block of blocks) {
    const lower = block.text.toLowerCase();
    const exactStart = lower.indexOf(normalizedKeyword);
    if (exactStart >= 0) {
      return {
        blockId: block.id,
        excerpt: excerptAround(block.text, exactStart, exactStart + keyword.length),
        keyword,
        matchType: "exact",
        surfaceTerms: [block.text.slice(exactStart, exactStart + keyword.length)],
        ranges: [{ start: exactStart, end: exactStart + keyword.length }],
      };
    }
  }

  const requiredConcepts = keywordConcepts(keyword);
  for (const block of blocks) {
    const concepts = corpusConcepts(block.text);
    if (!keywordMatchesCorpus(block.text.toLowerCase(), concepts, keyword)) continue;
    const ranges: { start: number; end: number }[] = [];
    const surfaceTerms: string[] = [];
    const seen = new Set<string>();
    const tokenPattern = /[a-z0-9.#+-]+/gi;
    for (const match of block.text.matchAll(tokenPattern)) {
      const surface = match[0];
      const concept = conceptOf(surface.toLowerCase());
      if (!requiredConcepts.includes(concept) || seen.has(concept)) continue;
      seen.add(concept);
      const start = match.index ?? 0;
      ranges.push({ start, end: start + surface.length });
      surfaceTerms.push(surface);
    }
    const first = ranges[0] ?? { start: 0, end: Math.min(block.text.length, 1) };
    return {
      blockId: block.id,
      excerpt: excerptAround(block.text, first.start, ranges.at(-1)?.end ?? first.end),
      keyword,
      matchType: "conceptual",
      surfaceTerms,
      ranges,
    };
  }
  return undefined;
}
