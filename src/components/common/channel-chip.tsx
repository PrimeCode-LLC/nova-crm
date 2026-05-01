import {
  Mail,
  MailPlus,
  Network,
  UserPlus,
  Globe,
  Briefcase,
  FileText,
  type LucideIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { CHANNELS } from "@/lib/constants";
import type { ChannelKey } from "@/lib/types";
import { cn } from "@/lib/utils";

const ICONS: Record<string, LucideIcon> = {
  Mail,
  MailPlus,
  Linkedin: Network,
  UserPlus,
  Globe,
  Briefcase,
  FileText,
};

const channelTone: Record<ChannelKey, string> = {
  cold_email: "text-indigo-300 bg-indigo-500/10 border-indigo-500/20",
  personalized_email: "text-sky-300 bg-sky-500/10 border-sky-500/20",
  linkedin_outbound: "text-cyan-300 bg-cyan-500/10 border-cyan-500/20",
  linkedin_1to1: "text-teal-300 bg-teal-500/10 border-teal-500/20",
  website_form: "text-violet-300 bg-violet-500/10 border-violet-500/20",
  upwork: "text-emerald-300 bg-emerald-500/10 border-emerald-500/20",
  job_apply: "text-amber-300 bg-amber-500/10 border-amber-500/20",
};

export function ChannelChip({
  channel,
  compact,
  className,
}: {
  channel: ChannelKey;
  compact?: boolean;
  className?: string;
}) {
  const meta = CHANNELS[channel];
  const Icon = ICONS[meta.iconKey] ?? Mail;
  return (
    <Badge
      variant="outline"
      className={cn(
        "rounded-md font-medium gap-1.5 px-1.5 py-0.5",
        channelTone[channel],
        className,
      )}
    >
      <Icon className="h-3 w-3" />
      {!compact && <span>{meta.short}</span>}
    </Badge>
  );
}
