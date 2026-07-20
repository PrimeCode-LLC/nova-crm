"use client";

import { Settings2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import {
  isStrategyScoreboardVisible,
  type StrategyScoreboardVisibility,
} from "@/lib/dashboard-preferences";

export type StrategyScoreboardOption = {
  id: string;
  name: string;
  activeAssignees: number;
};

export function StrategyScoreboardSettings({
  strategies,
  visible,
  onChange,
  onShowAll,
  onHideAll,
}: {
  strategies: StrategyScoreboardOption[];
  visible: StrategyScoreboardVisibility;
  onChange: (strategyId: string, enabled: boolean) => void;
  onShowAll: () => void;
  onHideAll: () => void;
}) {
  const hiddenCount = strategies.filter((s) => !isStrategyScoreboardVisible(visible, s.id)).length;

  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="relative text-muted-foreground"
            aria-label="Strategy scoreboard settings"
          >
            <Settings2 className="h-3.5 w-3.5" />
            {hiddenCount > 0 ? (
              <Badge
                variant="secondary"
                className="absolute -top-1 -right-1 h-4 min-w-4 justify-center px-1 text-[10px] font-normal"
              >
                {hiddenCount}
              </Badge>
            ) : null}
          </Button>
        }
      />
      <PopoverContent align="end" className="w-72 gap-3 p-3">
        <PopoverHeader>
          <PopoverTitle>Visible strategies</PopoverTitle>
          <PopoverDescription>
            Only published strategies appear here. Turn off ones your team is not working on.
            Saved on this browser.
          </PopoverDescription>
        </PopoverHeader>

        <div className="flex justify-end gap-1">
          <Button type="button" variant="ghost" size="xs" onClick={onShowAll}>
            All on
          </Button>
          <Button type="button" variant="ghost" size="xs" onClick={onHideAll}>
            All off
          </Button>
        </div>

        {strategies.length === 0 ? (
          <p className="py-2 text-center text-xs text-muted-foreground">
            No published strategies yet.
          </p>
        ) : (
          <ul className="max-h-64 space-y-2.5 overflow-y-auto pr-0.5">
            {strategies.map((strategy) => {
              const on = isStrategyScoreboardVisible(visible, strategy.id);
              return (
                <li key={strategy.id} className="flex items-center justify-between gap-3">
                  <Label
                    htmlFor={`strategy-board-${strategy.id}`}
                    className="min-w-0 cursor-pointer text-sm font-normal leading-snug"
                  >
                    <span className="block truncate">{strategy.name}</span>
                    {strategy.activeAssignees > 0 ? (
                      <span className="text-[10px] text-muted-foreground">
                        {strategy.activeAssignees} assignee
                        {strategy.activeAssignees === 1 ? "" : "s"} active
                      </span>
                    ) : (
                      <span className="text-[10px] text-muted-foreground">No active assignees</span>
                    )}
                  </Label>
                  <Switch
                    id={`strategy-board-${strategy.id}`}
                    size="sm"
                    checked={on}
                    onCheckedChange={(checked) => onChange(strategy.id, Boolean(checked))}
                  />
                </li>
              );
            })}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}
