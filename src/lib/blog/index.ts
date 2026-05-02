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

import { post as multiChannel } from "@/content/blog/multi-channel-pipeline-visibility";
import { post as twoLayer } from "@/content/blog/two-layer-tracking-model";
import { post as replacingSheets } from "@/content/blog/replacing-google-sheets-for-sales";

const POSTS: BlogPost[] = [multiChannel, twoLayer, replacingSheets];

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
