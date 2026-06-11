import { ChannelChip } from "@/components/common/channel-chip";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { ChannelKey } from "@/lib/types";
import { cn } from "@/lib/utils";

export function ChannelTagsRow({
  channelTags,
  fallbackChannel,
  compact,
  className,
  tagTooltips,
}: {
  channelTags?: ChannelKey[];
  fallbackChannel?: ChannelKey;
  compact?: boolean;
  className?: string;
  /** Per-channel hover text (channel name + pusher, etc.). */
  tagTooltips?: ReadonlyMap<ChannelKey, string>;
}) {
  const tags = channelTags?.length ? channelTags : fallbackChannel ? [fallbackChannel] : [];
  if (!tags.length) return null;

  return (
    <div className={cn("flex flex-wrap items-center gap-1", className)}>
      {tags.map((tag) => {
        const chip = <ChannelChip channel={tag} compact={compact} />;
        const tooltip = tagTooltips?.get(tag);
        if (!tooltip) return <span key={tag}>{chip}</span>;

        return (
          <Tooltip key={tag}>
            <TooltipTrigger
              render={
                <span className="inline-flex cursor-default" onClick={(e) => e.stopPropagation()}>
                  {chip}
                </span>
              }
            />
            <TooltipContent side="top">{tooltip}</TooltipContent>
          </Tooltip>
        );
      })}
    </div>
  );
}
