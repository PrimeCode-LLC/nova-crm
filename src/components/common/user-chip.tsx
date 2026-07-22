"use client";

import Link from "next/link";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { useWorkspace } from "@/components/providers/workspace-mode-provider";
import { cn } from "@/lib/utils";

export function UserChip({
  userId,
  size = "sm",
  nameOnly = false,
  className,
  profileHref,
}: {
  userId?: string;
  size?: "xs" | "sm" | "md";
  nameOnly?: boolean;
  className?: string;
  /** When set, the chip is a link (e.g. `/admin/users?user=u-123`). */
  profileHref?: string;
}) {
  const { getUserById, getOwnerDisplayName } = useWorkspace();
  const uid = userId?.trim() ?? "";
  if (!uid) return <span className="text-muted-foreground text-xs">Unassigned</span>;

  const user = getUserById(uid);
  const displayName = user?.displayName?.trim() || getOwnerDisplayName(uid) || "";
  if (!displayName) {
    return <span className="text-muted-foreground text-xs">Unknown owner</span>;
  }

  const initials = displayName
    .split(" ")
    .map((n) => n[0])
    .join("")
    .slice(0, 2);

  const dims =
    size === "xs" ? "h-5 w-5 text-[9px]" : size === "md" ? "h-7 w-7 text-xs" : "h-6 w-6 text-[10px]";

  const inner = (
    <>
      <Avatar className={cn(dims, "rounded-full")}>
        <AvatarFallback className="bg-primary/15 text-primary font-semibold">
          {initials}
        </AvatarFallback>
      </Avatar>
      {!nameOnly && (
        <span className={cn("truncate", size === "xs" ? "text-[11px]" : "text-sm")}>{displayName}</span>
      )}
    </>
  );

  const rowClass = cn(
    "flex items-center gap-2 min-w-0",
    profileHref &&
      "rounded-md -mx-1 px-1 py-0.5 hover:bg-muted/60 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring",
    className,
  );

  if (profileHref) {
    return (
      <Link href={profileHref} className={rowClass}>
        {inner}
      </Link>
    );
  }

  return <div className={rowClass}>{inner}</div>;
}
