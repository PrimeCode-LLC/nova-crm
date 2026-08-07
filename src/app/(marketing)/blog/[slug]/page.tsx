import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowRight, Clock4 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CtaBand } from "@/components/marketing/cta-band";
import { Prose } from "@/components/marketing/prose";
import { Section } from "@/components/marketing/section";
import { formatDate, getAllPosts, getAllSlugs, getPostBySlug } from "@/lib/blog";
import { absoluteUrl, SITE } from "@/lib/site";

type Params = { slug: string };

export function generateStaticParams() {
  return getAllSlugs().map((slug) => ({ slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}): Promise<Metadata> {
  const { slug } = await params;
  const post = getPostBySlug(slug);
  if (!post) return {};
  return {
    title: post.title,
    description: post.description,
    openGraph: {
      title: post.title,
      description: post.description,
      type: "article",
      publishedTime: post.publishedAt,
      authors: [post.author.name],
      tags: post.tags,
    },
  };
}

export default async function BlogPostPage({
  params,
}: {
  params: Promise<Params>;
}) {
  const { slug } = await params;
  const post = getPostBySlug(slug);
  if (!post) notFound();

  const all = getAllPosts();
  const idx = all.findIndex((p) => p.slug === slug);
  const prev = idx >= 0 ? all[idx + 1] : undefined;
  const next = idx > 0 ? all[idx - 1] : undefined;
  const Content = post.Content;

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: post.title,
    description: post.description,
    datePublished: post.publishedAt,
    author: {
      "@type": "Organization",
      name: post.author.name,
    },
    publisher: {
      "@type": "Organization",
      name: SITE.name,
      url: SITE.url,
    },
    mainEntityOfPage: absoluteUrl(`/blog/${post.slug}`),
    keywords: post.tags.join(", "),
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <Section className="pt-20 pb-8" containerClassName="max-w-3xl">
        <Button
          size="sm"
          variant="ghost"
          nativeButton={false}
          render={<Link href="/blog" />}
          className="-ml-2"
        >
          <ArrowLeft />
          All posts
        </Button>

        <header className="mt-8">
          <div className="flex flex-wrap items-center gap-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            {post.tags.map((tag) => (
              <span key={tag} className="rounded-full bg-muted px-2 py-0.5">
                {tag}
              </span>
            ))}
          </div>
          <h1 className="mt-5 text-4xl font-semibold tracking-tight sm:text-5xl">
            {post.title}
          </h1>
          <p className="mt-4 text-lg text-muted-foreground">
            {post.description}
          </p>
          <div className="mt-6 flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
            <span className="font-medium text-foreground">
              {post.author.name}
            </span>
            {post.author.role && (
              <>
                <span className="h-1 w-1 rounded-full bg-border" />
                <span>{post.author.role}</span>
              </>
            )}
            <span className="h-1 w-1 rounded-full bg-border" />
            <time dateTime={post.publishedAt}>
              {formatDate(post.publishedAt)}
            </time>
            <span className="h-1 w-1 rounded-full bg-border" />
            <span className="inline-flex items-center gap-1">
              <Clock4 className="h-3 w-3" />
              {post.readingTimeMin} min read
            </span>
          </div>
        </header>
      </Section>

      <Section className="py-8" containerClassName="max-w-3xl">
        <Prose>
          <Content />
        </Prose>
      </Section>

      {(prev || next) && (
        <Section className="py-8" containerClassName="max-w-3xl">
          <div className="grid gap-4 border-t border-border/60 pt-8 sm:grid-cols-2">
            {prev ? (
              <Link
                href={`/blog/${prev.slug}`}
                className="group rounded-xl border border-border/60 bg-card/60 p-5 transition-colors hover:border-border"
              >
                <span className="inline-flex items-center gap-1 text-[11px] uppercase tracking-wider text-muted-foreground">
                  <ArrowLeft className="h-3 w-3" />
                  Previous
                </span>
                <p className="mt-2 font-medium transition-colors group-hover:text-primary">
                  {prev.title}
                </p>
              </Link>
            ) : (
              <span />
            )}
            {next ? (
              <Link
                href={`/blog/${next.slug}`}
                className="group rounded-xl border border-border/60 bg-card/60 p-5 text-right transition-colors hover:border-border"
              >
                <span className="inline-flex items-center gap-1 text-[11px] uppercase tracking-wider text-muted-foreground">
                  Next
                  <ArrowRight className="h-3 w-3" />
                </span>
                <p className="mt-2 font-medium transition-colors group-hover:text-primary">
                  {next.title}
                </p>
              </Link>
            ) : (
              <span />
            )}
          </div>
        </Section>
      )}

      <CtaBand />
    </>
  );
}
