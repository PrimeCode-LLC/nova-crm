import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { getUserById } from "@/lib/mock-data";
import { cn } from "@/lib/utils";

export function UserChip({
  userId,
  size = "sm",
  nameOnly = false,
  className,
}: {
  userId?: string;
  size?: "xs" | "sm" | "md";
  nameOnly?: boolean;
  className?: string;
}) {
  const user = getUserById(userId ?? "");
  if (!user) return <span className="text-muted-foreground text-xs">Unassigned</span>;
  const initials = user.displayName
    .split(" ")
    .map((n) => n[0])
    .join("")
    .slice(0, 2);

  const dims =
    size === "xs" ? "h-5 w-5 text-[9px]" : size === "md" ? "h-7 w-7 text-xs" : "h-6 w-6 text-[10px]";

  return (
    <div className={cn("flex items-center gap-2 min-w-0", className)}>
      <Avatar className={cn(dims, "rounded-full")}>
        <AvatarFallback className="bg-primary/15 text-primary font-semibold">
          {initials}
        </AvatarFallback>
      </Avatar>
      {!nameOnly && (
        <span className="truncate text-sm">{user.displayName}</span>
      )}
    </div>
  );
}
