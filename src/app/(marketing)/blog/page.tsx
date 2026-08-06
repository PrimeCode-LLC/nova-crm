import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Clock4 } from "lucide-react";
import { Section, SectionHeading } from "@/components/marketing/section";
import { formatDate, getAllPosts } from "@/lib/blog";

export const metadata: Metadata = {
  title: "Blog",
  description:
    "Notes on intelligent prospect journeys, reply handling, and revenue execution — from the team building Nova.",
};

export default function BlogIndexPage() {
  const posts = getAllPosts();
  const [hero, ...rest] = posts;

  return (
    <>
      <Section className="pt-24 pb-12">
        <SectionHeading
          align="center"
          eyebrow="Blog"
          title="Field notes from the front lines."
          description="Plays on prospect journeys, reply intelligence, and outbound execution — written while building Nova."
        />
      </Section>

      <Section className="pt-0">
        {hero && (
          <Link
            href={`/blog/${hero.slug}`}
            className="group block overflow-hidden rounded-3xl border border-border/60 bg-card/60 backdrop-blur-sm transition-colors hover:border-border"
          >
            <div className="grid gap-0 md:grid-cols-[1.1fr_1fr]">
              <div className="relative hidden min-h-[280px] overflow-hidden md:block">
                <div
                  aria-hidden
                  className="absolute inset-0 bg-gradient-to-br from-primary/30 via-indigo-500/20 to-fuchsia-500/20"
                />
                <div
                  aria-hidden
                  className="absolute inset-0 bg-[radial-gradient(80%_60%_at_30%_30%,oklch(1_0_0/.08),transparent_70%)]"
                />
                <div className="absolute bottom-6 left-6 right-6 font-mono text-[11px] uppercase tracking-wider text-white/70">
                  Featured · {formatDate(hero.publishedAt)}
                </div>
              </div>
              <div className="p-8 sm:p-10">
                <div className="flex flex-wrap items-center gap-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                  {hero.tags.map((tag) => (
                    <span
                      key={tag}
                      className="rounded-full bg-muted px-2 py-0.5"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
                <h2 className="mt-4 text-2xl font-semibold tracking-tight transition-colors group-hover:text-primary sm:text-3xl">
                  {hero.title}
                </h2>
                <p className="mt-3 text-muted-foreground">{hero.description}</p>
                <div className="mt-6 flex items-center justify-between text-sm">
                  <div className="flex items-center gap-3 text-muted-foreground">
                    <span>{hero.author.name}</span>
                    <span className="h-1 w-1 rounded-full bg-border" />
                    <span className="inline-flex items-center gap-1">
                      <Clock4 className="h-3 w-3" />
                      {hero.readingTimeMin} min read
                    </span>
                  </div>
                  <span className="inline-flex items-center gap-1 text-primary">
                    Read
                    <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
                  </span>
                </div>
              </div>
            </div>
          </Link>
        )}

        {rest.length > 0 && (
          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {rest.map((post) => (
              <Link
                key={post.slug}
                href={`/blog/${post.slug}`}
                className="group flex flex-col rounded-2xl border border-border/60 bg-card/60 p-6 backdrop-blur-sm transition-colors hover:border-border"
              >
                <div className="flex flex-wrap items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                  <span>{formatDate(post.publishedAt)}</span>
                  <span className="h-1 w-1 rounded-full bg-border" />
                  <span className="inline-flex items-center gap-1">
                    <Clock4 className="h-2.5 w-2.5" />
                    {post.readingTimeMin} min
                  </span>
                </div>
                <h3 className="mt-3 text-lg font-semibold leading-snug transition-colors group-hover:text-primary">
                  {post.title}
                </h3>
                <p className="mt-2 flex-1 text-sm text-muted-foreground">
                  {post.description}
                </p>
                <div className="mt-5 flex flex-wrap gap-1.5">
                  {post.tags.slice(0, 3).map((tag) => (
                    <span
                      key={tag}
                      className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              </Link>
            ))}
          </div>
        )}
      </Section>
    </>
  );
}
