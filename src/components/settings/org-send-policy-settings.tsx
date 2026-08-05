"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import {
  DEFAULT_ORG_SEND_POLICY,
  resolveOrgSendPolicy,
  type OrgEmailSendPolicy,
} from "@/lib/email/org-send-policy";
import { WEEKDAY_KEYS } from "@/lib/scheduling/defaults";
import {
  buildTimezoneOptions,
  formatTimezoneDisplayLabel,
} from "@/lib/scheduling/timezone-options";
import type { AvailabilityTimeSlot, WeekdayKey } from "@/lib/types";
import { useWorkspace } from "@/components/providers/workspace-mode-provider";
import { Loader2 } from "lucide-react";

const DAY_LABEL: Record<WeekdayKey, string> = {
  monday: "Mon",
  tuesday: "Tue",
  wednesday: "Wed",
  thursday: "Thu",
  friday: "Fri",
  saturday: "Sat",
  sunday: "Sun",
};

export function OrgSendPolicySettings({
  orgName,
  onOrgNameChange,
}: {
  orgName: string;
  onOrgNameChange: (name: string) => void;
}) {
  const router = useRouter();
  const { organizationTimezone, isDemo } = useWorkspace();
  const [timezone, setTimezone] = React.useState(
    organizationTimezone?.trim() || "America/New_York",
  );
  const [policy, setPolicy] = React.useState<OrgEmailSendPolicy>(DEFAULT_ORG_SEND_POLICY);
  const [ceilingInput, setCeilingInput] = React.useState("");
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);

  const tzOptions = React.useMemo(() => buildTimezoneOptions(timezone), [timezone]);

  React.useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/org/settings");
        if (!res.ok) return;
        const data = (await res.json()) as {
          name?: string;
          timezone?: string;
          sendPolicy?: OrgEmailSendPolicy;
        };
        if (data.name?.trim()) onOrgNameChange(data.name.trim());
        if (data.timezone?.trim()) setTimezone(data.timezone.trim());
        const next = resolveOrgSendPolicy(data.sendPolicy);
        setPolicy(next);
        setCeilingInput(next.dailyCeiling != null ? String(next.dailyCeiling) : "");
      } catch {
        /* ignore */
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load once
  }, []);

  function setDayEnabled(day: WeekdayKey, enabled: boolean) {
    setPolicy((prev) => ({
      ...prev,
      weekly: {
        ...prev.weekly,
        [day]: enabled ? [{ start: "09:00", end: "17:00" }] : [],
      },
    }));
  }

  function setDaySlot(day: WeekdayKey, patch: Partial<AvailabilityTimeSlot>) {
    setPolicy((prev) => {
      const current = prev.weekly[day]?.[0] ?? { start: "09:00", end: "17:00" };
      return {
        ...prev,
        weekly: {
          ...prev.weekly,
          [day]: [{ ...current, ...patch }],
        },
      };
    });
  }

  async function handleSave() {
    if (isDemo) {
      toast.info("Workspace send hours are not saved in Demo mode.");
      return;
    }
    const ceilingRaw = ceilingInput.trim();
    const dailyCeiling =
      ceilingRaw === ""
        ? null
        : Number.isFinite(Number(ceilingRaw)) && Number(ceilingRaw) > 0
          ? Math.floor(Number(ceilingRaw))
          : null;
    setSaving(true);
    try {
      const res = await fetch("/api/org/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: orgName.trim(),
          settings: {
            timezone,
            sendPolicy: {
              ...policy,
              weekdayOnly: true,
              dailyCeiling,
            },
          },
        }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: unknown };
      if (!res.ok || !data.ok) {
        toast.error("Could not save workspace settings");
        return;
      }
      toast.success("Workspace settings saved");
      router.refresh();
    } catch {
      toast.error("Could not save workspace settings");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-6 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Loading workspace settings…
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label className="text-xs">Organization name</Label>
        <Input value={orgName} onChange={(e) => onOrgNameChange(e.target.value)} className="h-9" />
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs">Organization timezone</Label>
        <Select
          value={timezone}
          onValueChange={(value) => {
            if (value) setTimezone(value);
          }}
        >
          <SelectTrigger className="h-9 w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {tzOptions.map((tz) => (
              <SelectItem key={tz} value={tz}>
                {formatTimezoneDisplayLabel(tz)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-[11px] text-muted-foreground">
          Dashboards, daily limits, and auto-scheduling use this clock.
        </p>
      </div>
      <div className="space-y-2">
        <Label className="text-xs">Email working hours</Label>
        <p className="text-[11px] text-muted-foreground">
          Auto and bulk sequence scheduling stay inside these hours and skip closed days.
        </p>
        <div className="space-y-2 rounded-md border p-3">
          {WEEKDAY_KEYS.map((day) => {
            const slot = policy.weekly[day]?.[0];
            const enabled = Boolean(slot);
            return (
              <div key={day} className="flex flex-wrap items-center gap-2">
                <Switch
                  checked={enabled}
                  onCheckedChange={(v) => setDayEnabled(day, v)}
                  id={`send-day-${day}`}
                />
                <Label htmlFor={`send-day-${day}`} className="w-10 text-xs">
                  {DAY_LABEL[day]}
                </Label>
                <Input
                  type="time"
                  className="h-8 w-[7.5rem]"
                  disabled={!enabled}
                  value={slot?.start ?? "09:00"}
                  onChange={(e) => setDaySlot(day, { start: e.target.value })}
                />
                <span className="text-xs text-muted-foreground">to</span>
                <Input
                  type="time"
                  className="h-8 w-[7.5rem]"
                  disabled={!enabled}
                  value={slot?.end ?? "17:00"}
                  onChange={(e) => setDaySlot(day, { end: e.target.value })}
                />
              </div>
            );
          })}
        </div>
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs">Organization daily send ceiling (optional)</Label>
        <Input
          type="number"
          min={1}
          placeholder="No org-wide cap"
          value={ceilingInput}
          onChange={(e) => setCeilingInput(e.target.value)}
          className="h-9"
        />
        <p className="text-[11px] text-muted-foreground">
          Caps sent + queued emails per org day across every inbox. Leave blank to use mailbox
          limits only.
        </p>
      </div>
      <div className="flex justify-end">
        <Button size="sm" onClick={() => void handleSave()} disabled={saving || !orgName.trim()}>
          {saving ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
          Save changes
        </Button>
      </div>
    </div>
  );
}
