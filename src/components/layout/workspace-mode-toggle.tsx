"use client";

import * as React from "react";
import { FlaskConical, Briefcase } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import { useWorkspace } from "@/components/providers/workspace-mode-provider";
import { cn } from "@/lib/utils";

export function WorkspaceModeToggle() {
  const { mode, isDemo, setMode } = useWorkspace();
  const [pending, setPending] = React.useState(false);

  async function select(next: typeof mode) {
    if (next === mode) return;
    setPending(true);
    try {
      await setMode(next);
    } finally {
      setPending(false);
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="outline"
            size="sm"
            className={cn(
              "h-8 gap-1.5 px-2.5 text-xs font-medium",
              isDemo && "border-warning/40 bg-warning/5 text-warning",
            )}
            disabled={pending}
          >
            {isDemo ? (
              <>
                <FlaskConical className="h-3.5 w-3.5" />
                Demo
              </>
            ) : (
              <>
                <Briefcase className="h-3.5 w-3.5" />
                Workspace
              </>
            )}
            <Badge variant="secondary" className="ml-0.5 h-4 px-1 text-[9px] font-normal text-muted-foreground">
              {pending ? "…" : mode === "demo" ? "sample" : "live"}
            </Badge>
          </Button>
        }
      />
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
            Data mode
          </DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem onSelect={() => void select("demo")} className="gap-2 text-sm">
            <FlaskConical className="h-4 w-4 text-warning" />
            <div className="flex flex-col gap-0.5">
              <span>Demo</span>
              <span className="text-[11px] text-muted-foreground font-normal">
                Sample pipeline for tours and training.
              </span>
            </div>
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => void select("live")} className="gap-2 text-sm">
            <Briefcase className="h-4 w-4 text-info" />
            <div className="flex flex-col gap-0.5">
              <span>Workspace</span>
              <span className="text-[11px] text-muted-foreground font-normal">
                Your real CRM data (empty until connected).
              </span>
            </div>
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
