import type { ScraperCategory, ScraperPlatform } from "@/lib/types";

export type DefaultFeedSeed = {
  name: string;
  platform: ScraperPlatform;
  category: ScraperCategory;
  feedUrl: string;
};

/** Default RSS feeds migrated from the n8n workflow (rss.app). */
export const DEFAULT_SCRAPER_FEEDS: DefaultFeedSeed[] = [
  // ── Hiring · Reddit ──
  { name: "r/hire", platform: "reddit", category: "hiring", feedUrl: "https://rss.app/feeds/0U7V9t2ccz8qy1L8.xml" },
  { name: "JBS - Developer", platform: "reddit", category: "hiring", feedUrl: "https://rss.app/feeds/hujAKlhzAU4pZk5i.xml" },
  { name: "r/hiring/webdeveloper", platform: "reddit", category: "hiring", feedUrl: "https://rss.app/feeds/wDWAgIk8odzExYSL.xml" },
  { name: "r/forhire web developer", platform: "reddit", category: "hiring", feedUrl: "https://rss.app/feeds/ywcSIluydvchlf95.xml" },
  // ── Hiring · X ──
  { name: "Full stack · X", platform: "x", category: "hiring", feedUrl: "https://rss.app/feeds/vwujhJjUVHb51JC3.xml" },
  { name: ".NET · X", platform: "x", category: "hiring", feedUrl: "https://rss.app/feeds/C2GgemaK8luaPcEC.xml" },
  { name: "PHP · X", platform: "x", category: "hiring", feedUrl: "https://rss.app/feeds/Mo6v1JLCHxDW9Qqh.xml" },
  { name: "Backend · X", platform: "x", category: "hiring", feedUrl: "https://rss.app/feeds/vrE7iZmEGn47XvwZ.xml" },
  // ── Hiring · LinkedIn ──
  { name: "Full stack · LinkedIn", platform: "linkedin", category: "hiring", feedUrl: "https://rss.app/feeds/MLx5MIaOnVkCXtGS.xml" },
  { name: "WordPress · LinkedIn", platform: "linkedin", category: "hiring", feedUrl: "https://rss.app/feeds/OWPsHXXrs5cy25tH.xml" },
  { name: "React.js · LinkedIn", platform: "linkedin", category: "hiring", feedUrl: "https://rss.app/feeds/D9HWSmyq06C0nTzN.xml" },
  { name: ".NET · LinkedIn", platform: "linkedin", category: "hiring", feedUrl: "https://rss.app/feeds/7iuSLtQFkmknfuaU.xml" },
  // ── Problem · X ──
  { name: "Problem X · WordPress", platform: "x", category: "problem", feedUrl: "https://rss.app/feeds/JStVQWFpcQQvZHiu.xml" },
  { name: "Problem X · Automate jobs", platform: "x", category: "problem", feedUrl: "https://rss.app/feeds/6r161BuAuOWRoGMR.xml" },
  { name: "Problem X · WP / Laravel", platform: "x", category: "problem", feedUrl: "https://rss.app/feeds/3nBgZZqmGmlPupYZ.xml" },
  { name: "Problem X · React.js", platform: "x", category: "problem", feedUrl: "https://rss.app/feeds/z9k6QYMQTkIQlu4a.xml" },
  { name: "Problem X · SEO", platform: "x", category: "problem", feedUrl: "https://rss.app/feeds/tXpUeuFIPaUnWQnK.xml" },
  { name: "Problem X · Error automation", platform: "x", category: "problem", feedUrl: "https://rss.app/feeds/94L3UpEgn30pKe2o.xml" },
  { name: "Problem X · Pixel / tracking broken", platform: "x", category: "problem", feedUrl: "https://rss.app/feeds/eEzSNU9d6WWD0eaC.xml" },
  { name: "Problem X · AWS / Azure / Docker", platform: "x", category: "problem", feedUrl: "https://rss.app/feeds/h3wy7CwyxJIT86Vi.xml" },
  { name: "Problem X · Stripe / payment errors", platform: "x", category: "problem", feedUrl: "https://rss.app/feeds/vYvGfcRNsN93GY0d.xml" },
  { name: "Problem X · Site audit", platform: "x", category: "problem", feedUrl: "https://rss.app/feeds/ziHNhdahPsuCzRUq.xml" },
  { name: "Problem X · Site slow / crash", platform: "x", category: "problem", feedUrl: "https://rss.app/feeds/a5oQCiLP4vZaDKDU.xml" },
  // ── Problem · Reddit ──
  { name: "Problem Reddit · Website software", platform: "reddit", category: "problem", feedUrl: "https://rss.app/feeds/uX0lJMyY9AfqCuwo.xml" },
  { name: "Problem Reddit · Need developer", platform: "reddit", category: "problem", feedUrl: "https://rss.app/feeds/RJaWhqrytbc6iYWJ.xml" },
  { name: "Problem Reddit · r/wordpress", platform: "reddit", category: "problem", feedUrl: "https://rss.app/feeds/5RcANbTNQVx0VCF4.xml" },
  { name: "Problem Reddit · Custom developer", platform: "reddit", category: "problem", feedUrl: "https://rss.app/feeds/guH7hvV8P7i1kbCT.xml" },
  { name: "Problem Reddit · Broken / help", platform: "reddit", category: "problem", feedUrl: "https://rss.app/feeds/hNPZm7XEUw57OnJf.xml" },
  { name: "Problem Reddit · Automate process", platform: "reddit", category: "problem", feedUrl: "https://rss.app/feeds/mJ0PgskrZnJZQL8d.xml" },
  { name: "Problem Reddit · Software agency", platform: "reddit", category: "problem", feedUrl: "https://rss.app/feeds/DRWMcCX16nmsKbVS.xml" },
  { name: "Problem Reddit · SEO", platform: "reddit", category: "problem", feedUrl: "https://rss.app/feeds/BR3IOWL4LdGVZ8oG.xml" },
  { name: "Problem Reddit · Automation", platform: "reddit", category: "problem", feedUrl: "https://rss.app/feeds/2FOO8r2U9StGrize.xml" },
  { name: "Problem Reddit · Broken / error", platform: "reddit", category: "problem", feedUrl: "https://rss.app/feeds/lz9guyef3xxTYkwn.xml" },
  { name: "Problem Reddit · Setup / migrate", platform: "reddit", category: "problem", feedUrl: "https://rss.app/feeds/jvdqqja3CZJquCud.xml" },
  { name: "Problem Reddit · Integration / webhook", platform: "reddit", category: "problem", feedUrl: "https://rss.app/feeds/gclnUhNGfdKAVuMi.xml" },
  { name: "Problem Reddit · ADA / accessibility", platform: "reddit", category: "problem", feedUrl: "https://rss.app/feeds/MQyLJCpzcAHe1pFd.xml" },
  { name: "Problem Reddit · Timeout / crash", platform: "reddit", category: "problem", feedUrl: "https://rss.app/feeds/cGBKtiaSNTSKAHYH.xml" },
  // ── Problem · LinkedIn ──
  { name: "Problem LinkedIn · WordPress", platform: "linkedin", category: "problem", feedUrl: "https://rss.app/feeds/gHNCgbkG9Py6JFI5.xml" },
  { name: "Problem LinkedIn · React.js", platform: "linkedin", category: "problem", feedUrl: "https://rss.app/feeds/GipSIQVvAVpPqbS2.xml" },
  { name: "Problem LinkedIn · SEO", platform: "linkedin", category: "problem", feedUrl: "https://rss.app/feeds/iIHaFl0BTxg4Q9pS.xml" },
  { name: "Problem LinkedIn · Automation", platform: "linkedin", category: "problem", feedUrl: "https://rss.app/feeds/eEGPtvOjAb5dOKAH.xml" },
  { name: "Problem LinkedIn · ADA / errors", platform: "linkedin", category: "problem", feedUrl: "https://rss.app/feeds/PT4n07DvScCwMvcJ.xml" },
  { name: "Problem LinkedIn · AWS / Azure", platform: "linkedin", category: "problem", feedUrl: "https://rss.app/feeds/tYEiOI9uCXr2J8X1.xml" },
  { name: "Problem LinkedIn · Stripe / payments", platform: "linkedin", category: "problem", feedUrl: "https://rss.app/feeds/tu5NEQ5PFNKELyoV.xml" },
  { name: "Problem LinkedIn · Accessibility audit", platform: "linkedin", category: "problem", feedUrl: "https://rss.app/feeds/tiDmkkmTvxOoUNMg.xml" },
  { name: "Problem LinkedIn · Technical debt", platform: "linkedin", category: "problem", feedUrl: "https://rss.app/feeds/ti7xjEDcuFwOLzYJ.xml" },
];

export const RAW_ITEM_RETENTION_DAYS = 7;
