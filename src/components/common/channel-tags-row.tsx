import { ChannelChip } from "@/components/common/channel-chip";
import type { ChannelKey } from "@/lib/types";
import { cn } from "@/lib/utils";

export function ChannelTagsRow({
  channelTags,
  fallbackChannel,
  compact,
  className,
}: {
  channelTags?: ChannelKey[];
  fallbackChannel?: ChannelKey;
  compact?: boolean;
  className?: string;
}) {
  const tags = channelTags?.length ? channelTags : fallbackChannel ? [fallbackChannel] : [];
  if (!tags.length) return null;

  return (
    <div className={cn("flex flex-wrap items-center gap-1", className)}>
      {tags.map((tag) => (
        <ChannelChip key={tag} channel={tag} compact={compact} />
      ))}
    </div>
  );
}
