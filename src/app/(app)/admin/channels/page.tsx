"use client";

import * as React from "react";
import { PageBody, PageHeader } from "@/components/common/page-header";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { ChannelChip } from "@/components/common/channel-chip";
import { CHANNELS, CHANNEL_FUNNELS, CHANNEL_LIST } from "@/lib/constants";
import type { ChannelKey } from "@/lib/types";
import { Settings, Plus } from "lucide-react";
import { toast } from "sonner";

const CHANNEL_DESCRIPTIONS: Record<ChannelKey, string> = {
  cold_email: "Mass outbound email campaigns via Instantly. High volume, low personalization.",
  personalized_email: "1:1 hand-crafted outreach. Low volume, high intent signal.",
  linkedin_outbound: "Connection requests + message sequences on LinkedIn.",
  linkedin_1to1: "Direct messages to first-degree connections. Warm approach.",
  website_form: "Inbound leads from website contact forms or chatbot.",
  upwork: "Proposal submissions on Upwork platform.",
  job_apply: "CV-based outreach applied to job postings as a lead-gen strategy.",
};

export default function AdminChannelsPage() {
  const [autoMap, setAutoMap] = React.useState<Record<ChannelKey, boolean>>({
    cold_email: true,
    personalized_email: false,
    linkedin_outbound: true,
    linkedin_1to1: false,
    website_form: true,
    upwork: false,
    job_apply: false,
  });

  return (
    <>
      <PageHeader
        title="Channels"
        description="Configure outreach channels, funnel stages, and automation rules."
        actions={
          <Button variant="outline" size="sm" onClick={() => toast.info("Custom channel UI (coming soon)")}>
            <Plus className="h-3.5 w-3.5" /> Add custom channel
          </Button>
        }
      />
      <PageBody>
        <div className="rounded-md border overflow-hidden divide-y">
          {CHANNEL_LIST.map((ch) => {
            const funnelStages = CHANNEL_FUNNELS[ch.key];
            return (
              <div
                key={ch.key}
                className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4 px-4 py-3 hover:bg-muted/20 transition-colors"
              >
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  <ChannelChip channel={ch.key} />
                  <div className="min-w-0">
                    <div className="text-sm font-medium">{ch.label}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      {CHANNEL_DESCRIPTIONS[ch.key]}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-4 shrink-0">
                  <div className="hidden sm:flex items-center gap-1.5 flex-wrap max-w-[260px]">
                    {funnelStages.map((s, i) => (
                      <React.Fragment key={s.key}>
                        <Badge
                          variant="outline"
                          className="text-[10px] font-normal px-1.5 py-0"
                        >
                          {s.label}
                        </Badge>
                        {i < funnelStages.length - 1 && (
                          <span className="text-muted-foreground/40 text-[10px]">→</span>
                        )}
                      </React.Fragment>
                    ))}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">Auto</span>
                    <Switch
                      checked={autoMap[ch.key]}
                      onCheckedChange={(v) => {
                        setAutoMap((prev) => ({ ...prev, [ch.key]: !!v }));
                        toast.success(`${ch.label}: auto ${!!v ? "enabled" : "disabled"}`);
                      }}
                    />
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7"
                    onClick={() => toast.info(`Configure ${ch.label} (coming soon)`)}
                  >
                    <Settings className="h-3.5 w-3.5" /> Configure
                  </Button>
                </div>
              </div>
            );
          })}
        </div>

        <Card className="bg-muted/20">
          <CardContent className="p-4">
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-2">
              Custom channels
            </div>
            <p className="text-sm text-muted-foreground">
              You can define custom channels with their own funnel stages and automation rules.
              Custom channels appear here alongside built-in ones.
            </p>
            <Button
              variant="outline"
              size="sm"
              className="mt-3"
              onClick={() => toast.info("Custom channel creation (coming soon)")}
            >
              <Plus className="h-3.5 w-3.5" /> Add custom channel
            </Button>
          </CardContent>
        </Card>
      </PageBody>
    </>
  );
}
