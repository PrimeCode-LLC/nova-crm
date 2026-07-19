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
import { CHANNEL_LIST } from "@/lib/constants";
import type { ChannelFunnelsVisibility } from "@/lib/dashboard-preferences";
import type { ChannelKey } from "@/lib/types";

export function ChannelFunnelsSettings({
  visible,
  onChange,
  onShowAll,
  onHideAll,
}: {
  visible: ChannelFunnelsVisibility;
  onChange: (channel: ChannelKey, enabled: boolean) => void;
  onShowAll: () => void;
  onHideAll: () => void;
}) {
  const hiddenCount = CHANNEL_LIST.filter((c) => !visible[c.key]).length;

  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="relative text-muted-foreground"
            aria-label="Channel funnels settings"
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
      <PopoverContent align="end" className="w-64 gap-3 p-3">
        <PopoverHeader>
          <PopoverTitle>Visible channels</PopoverTitle>
          <PopoverDescription>
            Choose which funnel cards appear here. Saved on this browser.
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

        <ul className="space-y-2.5">
          {CHANNEL_LIST.map((channel) => (
            <li key={channel.key} className="flex items-center justify-between gap-3">
              <Label
                htmlFor={`funnel-ch-${channel.key}`}
                className="cursor-pointer text-sm font-normal"
              >
                {channel.label}
              </Label>
              <Switch
                id={`funnel-ch-${channel.key}`}
                size="sm"
                checked={visible[channel.key]}
                onCheckedChange={(checked) => onChange(channel.key, Boolean(checked))}
              />
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
