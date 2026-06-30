"use client";

import * as React from "react";
import { Flag } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  DEFAULT_MAIL_FLAG_ID,
  MAIL_FLAG_PRESETS,
  type MailFlagId,
  mailFlagById,
} from "@/lib/email/mail-flags";
import { cn } from "@/lib/utils";

export function MailFlagIcon({
  flagId,
  className,
  filled = true,
}: {
  flagId: MailFlagId;
  className?: string;
  filled?: boolean;
}) {
  const preset = mailFlagById(flagId);
  const color = preset?.color ?? "#FF9500";
  return (
    <Flag
      className={cn("shrink-0", className)}
      style={{ color }}
      fill={filled ? color : "none"}
      aria-hidden
    />
  );
}

export function MailFlagPicker({
  currentFlagId,
  disabled,
  onSetFlag,
  onClearFlag,
  onToggleFlag,
  size = "sm",
  className,
}: {
  currentFlagId: MailFlagId | null;
  disabled?: boolean;
  onSetFlag: (flagId: MailFlagId) => void;
  onClearFlag: () => void;
  onToggleFlag: () => void;
  size?: "sm" | "default" | "icon-sm";
  className?: string;
}) {
  const active = currentFlagId ? mailFlagById(currentFlagId) : null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            type="button"
            variant="outline"
            size={size === "icon-sm" ? "icon-sm" : size}
            className={cn(size === "icon-sm" ? "h-7 w-7" : "gap-1.5", className)}
            disabled={disabled}
            aria-label="Flag message"
          />
        }
      >
        <MailFlagIcon
          flagId={currentFlagId ?? DEFAULT_MAIL_FLAG_ID}
          className="h-3.5 w-3.5"
          filled={Boolean(currentFlagId)}
        />
        {size !== "icon-sm" ? "Flag" : null}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-44">
        {MAIL_FLAG_PRESETS.map((preset) => (
          <DropdownMenuItem
            key={preset.id}
            className="gap-2 text-xs"
            onClick={() => onSetFlag(preset.id)}
          >
            <MailFlagIcon flagId={preset.id} className="h-3.5 w-3.5" />
            {preset.name}
            {currentFlagId === preset.id ? (
              <span className="ml-auto text-[10px] text-muted-foreground">Current</span>
            ) : null}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          className="text-xs"
          disabled={!currentFlagId && !active}
          onClick={onClearFlag}
        >
          Clear Flag
        </DropdownMenuItem>
        <DropdownMenuItem className="text-xs" onClick={onToggleFlag}>
          Toggle Flag
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function MailFlagsSidebarSection({
  flagCounts,
  flaggedTotal,
  selectedFlagId,
  onSelectFlag,
  onClearFlag,
}: {
  flagCounts: Record<MailFlagId, number>;
  flaggedTotal: number;
  selectedFlagId: MailFlagId | null;
  onSelectFlag: (flagId: MailFlagId) => void;
  onClearFlag: () => void;
}) {
  return (
    <div className="space-y-1 pt-2 border-t border-border/60">
      <p className="px-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        Flags
      </p>
      <Button
        variant={selectedFlagId === null ? "secondary" : "ghost"}
        size="sm"
        className="h-7 w-full justify-start px-2 text-[11px]"
        onClick={onClearFlag}
      >
        <Flag className="h-3 w-3 shrink-0 text-muted-foreground" aria-hidden />
        <span className="truncate">All mail</span>
        {flaggedTotal > 0 ? (
          <Badge variant="outline" className="ml-auto h-5 px-1 text-[10px] tabular-nums shrink-0">
            {flaggedTotal} flagged
          </Badge>
        ) : null}
      </Button>
      {MAIL_FLAG_PRESETS.map((preset) => {
        const count = flagCounts[preset.id] ?? 0;
        const active = selectedFlagId === preset.id;
        return (
          <Button
            key={preset.id}
            variant={active ? "secondary" : "ghost"}
            size="sm"
            className="h-7 w-full justify-start px-2 text-[11px] gap-1.5"
            onClick={() => (active ? onClearFlag() : onSelectFlag(preset.id))}
          >
            <MailFlagIcon flagId={preset.id} className="h-3 w-3" />
            <span className="truncate">{preset.name}</span>
            {count > 0 ? (
              <Badge variant="outline" className="ml-auto h-5 px-1 text-[10px] tabular-nums shrink-0">
                {count}
              </Badge>
            ) : null}
          </Button>
        );
      })}
    </div>
  );
}
