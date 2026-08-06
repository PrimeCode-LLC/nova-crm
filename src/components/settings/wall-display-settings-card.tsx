"use client";

import Link from "next/link";
import { Monitor } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import { useWallPreferences } from "@/hooks/use-wall-preferences";
import { selectTriggerLabelByKey } from "@/lib/base-ui-select-label";
import { buildDashboardWallHref } from "@/lib/dashboard-date-range";
import { cn } from "@/lib/utils";
import {
  WALL_DWELL_OPTIONS,
  WALL_RESUME_IDLE_OPTIONS,
  WALL_SCENE_META,
} from "@/lib/wall-preferences";

export function WallDisplaySettingsCard({ userId }: { userId: string }) {
  const {
    prefs,
    setDwellSeconds,
    setResumeIdleSeconds,
    setShowProgressBar,
    setProgressBarPosition,
    setShowPulseStrip,
    setScene,
    reset,
  } = useWallPreferences(userId);

  const enabledSceneCount = Object.values(prefs.scenes).filter(Boolean).length;

  return (
    <Card className="max-w-lg">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <Monitor className="h-4 w-4 text-muted-foreground" />
          Wall display
        </CardTitle>
        <CardDescription className="text-xs">
          Timer, scenes, and chrome for the TV / wall command board. Saved on this browser.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <section className="space-y-3">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Timing
          </h3>
          <div className="space-y-1.5">
            <Label className="text-xs">Seconds per scene</Label>
            <Select
              value={String(prefs.dwellSeconds)}
              onValueChange={(v) => {
                if (!v) return;
                const seconds = Number(v);
                setDwellSeconds(seconds);
                toast.success(`Scene timer set to ${seconds}s`);
              }}
            >
              <SelectTrigger className="h-9 w-full">
                <SelectValue>
                  {selectTriggerLabelByKey(
                    String(prefs.dwellSeconds),
                    WALL_DWELL_OPTIONS.map((o) => ({ key: String(o.value), label: o.label })),
                  )}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {WALL_DWELL_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={String(o.value)}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-[11px] text-muted-foreground">
              How long each scene stays before rotating. Full loop ≈{" "}
              {prefs.dwellSeconds * Math.max(1, enabledSceneCount)}s with current scenes.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Resume after mouse idle</Label>
            <Select
              value={String(prefs.resumeIdleSeconds)}
              onValueChange={(v) => {
                if (!v) return;
                const seconds = Number(v);
                setResumeIdleSeconds(seconds);
                toast.success(`Resume idle set to ${seconds}s`);
              }}
            >
              <SelectTrigger className="h-9 w-full">
                <SelectValue>
                  {selectTriggerLabelByKey(
                    String(prefs.resumeIdleSeconds),
                    WALL_RESUME_IDLE_OPTIONS.map((o) => ({
                      key: String(o.value),
                      label: o.label,
                    })),
                  )}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {WALL_RESUME_IDLE_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={String(o.value)}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-[11px] text-muted-foreground">
              Rotation pauses when someone moves the mouse, then resumes after this idle time.
            </p>
          </div>
        </section>

        <Separator />

        <section className="space-y-3">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Progress bar
          </h3>
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-medium">Show countdown bar</p>
              <p className="text-[11px] text-muted-foreground">
                Fills as the current scene approaches the next switch.
              </p>
            </div>
            <Switch
              checked={prefs.showProgressBar}
              onCheckedChange={(on) => {
                setShowProgressBar(on);
                toast.success(on ? "Countdown bar on" : "Countdown bar off");
              }}
              aria-label="Show countdown bar"
            />
          </div>
          {prefs.showProgressBar ? (
            <div className="space-y-1.5">
              <Label className="text-xs">Bar position</Label>
              <Select
                value={prefs.progressBarPosition}
                onValueChange={(v) => {
                  if (v === "top" || v === "bottom") {
                    setProgressBarPosition(v);
                    toast.success(`Countdown bar at ${v}`);
                  }
                }}
              >
                <SelectTrigger className="h-9 w-full">
                  <SelectValue>
                    {prefs.progressBarPosition === "bottom" ? "Bottom" : "Top"}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="top">Top (under KPIs)</SelectItem>
                  <SelectItem value="bottom">Bottom (above footer)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          ) : null}
        </section>

        <Separator />

        <section className="space-y-3">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Chrome
          </h3>
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-medium">Pulse KPI strip</p>
              <p className="text-[11px] text-muted-foreground">
                Keep emails, replies, prospects, and other KPIs sticky above every scene.
              </p>
            </div>
            <Switch
              checked={prefs.showPulseStrip}
              onCheckedChange={(on) => {
                setShowPulseStrip(on);
                toast.success(on ? "Pulse strip on" : "Pulse strip off");
              }}
              aria-label="Show pulse KPI strip"
            />
          </div>
        </section>

        <Separator />

        <section className="space-y-3">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Scenes
          </h3>
          <p className="text-[11px] text-muted-foreground">
            At least one scene must stay on. Dashboard widget toggles still control what appears
            inside each scene.
          </p>
          <ul className="space-y-3">
            {WALL_SCENE_META.map((s) => (
              <li key={s.key} className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium">{s.label}</p>
                  <p className="text-[11px] text-muted-foreground">{s.description}</p>
                </div>
                <Switch
                  checked={prefs.scenes[s.key]}
                  onCheckedChange={(on) => {
                    setScene(s.key, on);
                    toast.success(on ? `${s.label} scene on` : `${s.label} scene off`);
                  }}
                  disabled={prefs.scenes[s.key] && enabledSceneCount <= 1}
                  aria-label={`Show ${s.label} scene`}
                />
              </li>
            ))}
          </ul>
        </section>

        <Separator />

        <div className="flex flex-wrap items-center gap-2">
          <Link
            href={buildDashboardWallHref("30d")}
            className={cn(buttonVariants({ variant: "default", size: "sm" }), "gap-1.5")}
          >
            <Monitor className="h-3.5 w-3.5" />
            Open wall mode
          </Link>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              reset();
              toast.success("Wall settings reset to defaults");
            }}
          >
            Reset defaults
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
