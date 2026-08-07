import type { ComponentType } from "react";

export type BlogPostMeta = {
  slug: string;
  title: string;
  description: string;
  /** ISO date, e.g. "2026-04-12" */
  publishedAt: string;
  author: { name: string; role?: string };
  tags: string[];
  readingTimeMin: number;
};

export type BlogPost = BlogPostMeta & {
  Content: ComponentType;
};

import { post as aiOutbound } from "@/content/blog/ai-outbound-without-hiring-sdr";
import { post as staticSequences } from "@/content/blog/why-static-cold-email-sequences-fail";
import { post as replyHandling } from "@/content/blog/handle-outbound-replies-without-drowning";
import { post as noHallucinations } from "@/content/blog/stop-ai-sales-emails-from-hallucinating";
import { post as followUpPlaybook } from "@/content/blog/cold-email-follow-up-playbook";
import { post as aiSdrVsHire } from "@/content/blog/ai-sdr-vs-hiring-an-sdr";
import { post as serviceFounders } from "@/content/blog/outbound-for-b2b-service-founders";
import { post as personalisedScale } from "@/content/blog/personalised-outbound-at-scale";

const POSTS: BlogPost[] = [
  aiOutbound,
  staticSequences,
  replyHandling,
  noHallucinations,
  followUpPlaybook,
  aiSdrVsHire,
  serviceFounders,
  personalisedScale,
];

export function getAllPosts(): BlogPost[] {
  return [...POSTS].sort((a, b) =>
    a.publishedAt < b.publishedAt ? 1 : a.publishedAt > b.publishedAt ? -1 : 0
  );
}

export function getPostBySlug(slug: string): BlogPost | undefined {
  return POSTS.find((p) => p.slug === slug);
}

export function getAllSlugs(): string[] {
  return POSTS.map((p) => p.slug);
}

export function formatDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}
