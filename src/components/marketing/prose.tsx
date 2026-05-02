import { cn } from "@/lib/utils";

/**
 * Long-form content wrapper. Targets headings/paragraphs/lists/code/quotes
 * with the existing design tokens, no @tailwindcss/typography needed.
 */
export function Prose({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "prose-content max-w-none text-base leading-relaxed text-foreground/90",
        "[&>h1]:mt-12 [&>h1]:mb-5 [&>h1]:text-3xl [&>h1]:font-semibold [&>h1]:tracking-tight",
        "[&>h2]:mt-12 [&>h2]:mb-4 [&>h2]:text-2xl [&>h2]:font-semibold [&>h2]:tracking-tight",
        "[&>h3]:mt-10 [&>h3]:mb-3 [&>h3]:text-lg [&>h3]:font-semibold",
        "[&>p]:my-5",
        "[&>ul]:my-5 [&>ul]:list-disc [&>ul]:pl-6 [&>ul>li]:mt-1.5",
        "[&>ol]:my-5 [&>ol]:list-decimal [&>ol]:pl-6 [&>ol>li]:mt-1.5",
        "[&_strong]:font-semibold [&_strong]:text-foreground",
        "[&_a]:text-primary [&_a]:underline [&_a]:underline-offset-2 hover:[&_a]:opacity-80",
        "[&>blockquote]:my-6 [&>blockquote]:border-l-2 [&>blockquote]:border-primary/50 [&>blockquote]:pl-4 [&>blockquote]:italic [&>blockquote]:text-muted-foreground",
        "[&_code]:rounded [&_code]:bg-muted [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[0.85em]",
        "[&>pre]:my-6 [&>pre]:overflow-x-auto [&>pre]:rounded-xl [&>pre]:border [&>pre]:border-border/60 [&>pre]:bg-card/60 [&>pre]:p-4 [&>pre]:text-sm",
        "[&>pre_code]:bg-transparent [&>pre_code]:p-0",
        "[&>hr]:my-12 [&>hr]:border-border/60",
        className
      )}
    >
      {children}
    </div>
  );
}
