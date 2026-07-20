"use client";

import { MessageResponse } from "@/components/ai-elements/message";
import { cn } from "@/lib/utils";

type MarkdownContentProps = {
  children: string;
  className?: string;
};

/** Renders AI/strategy markdown (bold, headers, lists) instead of raw `**` / `##`. */
export function MarkdownContent({ children, className }: MarkdownContentProps) {
  if (!children.trim()) return null;
  return (
    <MessageResponse
      className={cn(
        "text-sm text-foreground leading-relaxed",
        "[&_h1]:text-base [&_h1]:font-semibold [&_h1]:mt-3 [&_h1]:mb-1.5",
        "[&_h2]:text-sm [&_h2]:font-semibold [&_h2]:mt-3 [&_h2]:mb-1.5",
        "[&_h3]:text-sm [&_h3]:font-semibold [&_h3]:mt-2 [&_h3]:mb-1",
        "[&_p]:my-1.5 [&_ul]:my-1.5 [&_ol]:my-1.5 [&_li]:my-0.5",
        "[&_strong]:font-semibold [&_code]:text-xs",
        "[&_pre]:rounded-md [&_pre]:bg-muted/50 [&_pre]:p-2 [&_pre]:text-xs",
        className,
      )}
    >
      {children}
    </MessageResponse>
  );
}
