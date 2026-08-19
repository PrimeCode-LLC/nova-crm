import { Badge } from "@/components/ui/badge";
import type { OrganizationStatus } from "@/lib/types";
import { cn } from "@/lib/utils";

const STYLES: Record<OrganizationStatus, string> = {
  trial: "bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/20",
  active: "bg-success/10 text-success border-success/20",
  suspended: "bg-destructive/10 text-destructive border-destructive/20",
  archived: "bg-muted text-muted-foreground border-border",
};

export function OrgStatusBadge({
  status,
  className,
}: {
  status: OrganizationStatus;
  className?: string;
}) {
  return (
    <Badge variant="outline" className={cn(STYLES[status] ?? "", className)}>
      {status}
    </Badge>
  );
}
