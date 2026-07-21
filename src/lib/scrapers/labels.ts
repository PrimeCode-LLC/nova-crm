import type { ScraperCategory, ScraperPlatform } from "@/lib/types";

export const SCRAPER_PLATFORM_LABELS = {
  google_news: "Google News",
  bing_news: "Bing News",
  google_alerts: "Google Alerts",
  native_website_rss: "Native Website RSS",
  custom_website: "Custom Website",
  sam_gov: "SAM.gov",
  uk_contracts_finder: "UK Contracts Finder",
  uk_find_a_tender: "UK Find a Tender",
  ted_europe: "TED Europe",
  merx_canada: "MERX Canada",
  un_global_marketplace: "UN Global Marketplace",
  government_procurement_portal: "Government Procurement Portal",
  state_local_procurement_portal: "State / Local Procurement Portal",
  corporate_procurement_portal: "Corporate Procurement Portal",
  freightwaves: "FreightWaves",
  supply_chain_dive: "Supply Chain Dive",
  logistics_management: "Logistics Management",
  dc_velocity: "DC Velocity",
  industryweek: "IndustryWeek",
  manufacturing_net: "Manufacturing.net",
  iot_for_all: "IoT For All",
  rfid_journal: "RFID Journal",
  automation_world: "Automation World",
  devops_com: "DevOps.com",
  infoq: "InfoQ",
  healthcare_it_news: "Healthcare IT News",
  other_industry_publication: "Other Industry Publication",
  company_newsroom: "Company Newsroom",
  company_press_releases: "Company Press Releases",
  company_blog: "Company Blog",
  company_careers_page: "Company Careers Page",
  company_investor_relations: "Company Investor Relations",
  government_newsroom: "Government Newsroom",
  economic_development_website: "Economic Development Website",
  official_public_website: "Official Public Website",
  pr_newswire: "PR Newswire",
  business_wire: "Business Wire",
  globenewswire: "GlobeNewswire",
  other_press_release_source: "Other Press Release Source",
  linkedin_jobs: "LinkedIn Jobs",
  indeed: "Indeed",
  glassdoor: "Glassdoor",
  greenhouse: "Greenhouse",
  lever: "Lever",
  workday: "Workday",
  company_ats: "Company ATS",
  other_job_board: "Other Job Board",
  linkedin: "LinkedIn",
  x: "X / Twitter",
  reddit: "Reddit",
  facebook: "Facebook",
  threads: "Threads",
  bluesky: "Bluesky",
  youtube: "YouTube",
  telegram: "Telegram",
  other_social_platform: "Other Social Platform",
  rss_app: "RSS.app",
  direct_rss_atom: "Direct RSS / Atom",
  api: "API",
  web_scraper: "Web Scraper",
  newsletter: "Newsletter",
  manual_source: "Manual Source",
  other: "Other",
} as const;

export type ScraperPlatformPreset = keyof typeof SCRAPER_PLATFORM_LABELS;

export const SCRAPER_PLATFORM_PRESETS = Object.keys(SCRAPER_PLATFORM_LABELS) as ScraperPlatformPreset[];

export const SCRAPER_PLATFORM_GROUPS: {
  label: string;
  options: readonly ScraperPlatformPreset[];
}[] = [
  {
    label: "News and search",
    options: ["google_news", "bing_news", "google_alerts", "native_website_rss", "custom_website"],
  },
  {
    label: "Procurement",
    options: [
      "sam_gov",
      "uk_contracts_finder",
      "uk_find_a_tender",
      "ted_europe",
      "merx_canada",
      "un_global_marketplace",
      "government_procurement_portal",
      "state_local_procurement_portal",
      "corporate_procurement_portal",
    ],
  },
  {
    label: "Industry publications",
    options: [
      "freightwaves",
      "supply_chain_dive",
      "logistics_management",
      "dc_velocity",
      "industryweek",
      "manufacturing_net",
      "iot_for_all",
      "rfid_journal",
      "automation_world",
      "devops_com",
      "infoq",
      "healthcare_it_news",
      "other_industry_publication",
    ],
  },
  {
    label: "Official company sources",
    options: [
      "company_newsroom",
      "company_press_releases",
      "company_blog",
      "company_careers_page",
      "company_investor_relations",
      "government_newsroom",
      "economic_development_website",
      "official_public_website",
    ],
  },
  {
    label: "Press-release sources",
    options: ["pr_newswire", "business_wire", "globenewswire", "other_press_release_source"],
  },
  {
    label: "Hiring platforms",
    options: [
      "linkedin_jobs",
      "indeed",
      "glassdoor",
      "greenhouse",
      "lever",
      "workday",
      "company_ats",
      "other_job_board",
    ],
  },
  {
    label: "Social and community",
    options: [
      "linkedin",
      "x",
      "reddit",
      "facebook",
      "threads",
      "bluesky",
      "youtube",
      "telegram",
      "other_social_platform",
    ],
  },
  {
    label: "Technical source type",
    options: ["rss_app", "direct_rss_atom", "api", "web_scraper", "newsletter", "manual_source", "other"],
  },
];

export function isScraperPlatformPreset(platform: string): platform is ScraperPlatformPreset {
  return platform in SCRAPER_PLATFORM_LABELS;
}

export function getScraperPlatformLabel(platform: ScraperPlatform | undefined): string {
  const raw = platform?.trim();
  if (!raw) return "Other";
  if (isScraperPlatformPreset(raw)) return SCRAPER_PLATFORM_LABELS[raw];
  return raw
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (m) => m.toUpperCase());
}

export const SCRAPER_CATEGORY_LABELS = {
  procurement_rfp: "Procurement / RFP",
  supply_chain_logistics: "Supply Chain & Logistics",
  rfid_iot_industrial_automation: "RFID / IoT / Industrial Automation",
  dotnet_cloud_devops: ".NET / Cloud / DevOps",
  saas_ai_healthcare: "SaaS / AI / Healthcare",
  hiring: "Targeted Hiring",
  social_pain_partner_requests: "Social Pain / Partner Requests",
  company_expansion: "Company Expansion",
  technology_initiative: "Technology Initiative",
  problem: "Operational Problem",
  partnership_opportunity: "Partnership Opportunity",
  other: "Other",
} as const;

export type ScraperCategoryPreset = keyof typeof SCRAPER_CATEGORY_LABELS;

export const SCRAPER_CATEGORY_PRESETS = Object.keys(SCRAPER_CATEGORY_LABELS) as ScraperCategoryPreset[];

export function isScraperCategoryPreset(category: string): category is ScraperCategoryPreset {
  return category in SCRAPER_CATEGORY_LABELS;
}

export function getScraperCategoryLabel(category: ScraperCategory | undefined): string {
  const raw = category?.trim();
  if (!raw) return "Other";
  if (isScraperCategoryPreset(raw)) return SCRAPER_CATEGORY_LABELS[raw];
  return raw
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (m) => m.toUpperCase());
}
