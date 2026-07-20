import { cn } from "@/lib/utils";

/** Flex column shell for PageHeader + PageBody so the body can scroll inside the app viewport. */
export function AppPage({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex h-0 min-h-0 flex-1 flex-col overflow-hidden", className)}>{children}</div>
  );
}

export function PageHeader({
  title,
  description,
  actions,
  className,
  children,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex shrink-0 flex-col gap-2 border-b px-6 pt-5 pb-4 sm:flex-row sm:items-end sm:justify-between",
        className,
      )}
    >
      <div className="min-w-0">
        <h1 className="text-[22px] font-semibold tracking-tight">{title}</h1>
        {description && (
          <p className="text-sm text-muted-foreground mt-1">{description}</p>
        )}
        {children}
      </div>
      {actions && (
        <div className="flex shrink-0 flex-wrap items-center gap-2 sm:justify-end">
          {actions}
        </div>
      )}
    </div>
  );
}

export function PageBody({
  className,
  children,
  /** When true, children manage their own scroll regions (e.g. full-height data tables). */
  contained = false,
}: {
  className?: string;
  children: React.ReactNode;
  contained?: boolean;
}) {
  if (contained) {
    return (
      <div
        className={cn("flex min-h-0 flex-1 flex-col overflow-hidden p-6", className)}
      >
        {children}
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden p-6">
      <div
        className={cn(
          // [&>*]:shrink-0 keeps section height natural so this pane scrolls
          // instead of children compressing and clipping with no scrollbar.
          "flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto overscroll-y-contain scrollbar-thin [&>*]:shrink-0",
          className,
        )}
      >
        {children}
      </div>
    </div>
  );
}
