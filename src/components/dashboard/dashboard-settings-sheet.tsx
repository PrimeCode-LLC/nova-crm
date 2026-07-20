"use client";

import * as React from "react";
import { Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ROLES, roleLabel } from "@/lib/constants";
import {
  DASHBOARD_VIEW_MODE_OPTIONS,
  DASHBOARD_WIDGET_META,
  type DashboardPreferences,
  type DashboardViewMode,
  type DashboardWidgetKey,
} from "@/lib/dashboard-preferences";
import { selectTriggerLabelByKey } from "@/lib/base-ui-select-label";
import type { Role } from "@/lib/types";

const PREVIEW_ROLES: Role[] = [
  "director",
  "manager",
  "team_lead",
  "salesperson",
  "prospecting",
];

const VIEW_OPTIONS = DASHBOARD_VIEW_MODE_OPTIONS.map((o) => ({ key: o.key, label: o.label }));

export function DashboardSettingsSheet({
  prefs,
  canCustomize,
  onViewModeChange,
  onPreviewRoleChange,
  onWidgetChange,
  onEnableAll,
  onDisableAll,
  onReset,
}: {
  prefs: DashboardPreferences;
  canCustomize: boolean;
  onViewModeChange: (mode: DashboardViewMode) => void;
  onPreviewRoleChange: (role: Role | null) => void;
  onWidgetChange: (key: DashboardWidgetKey, enabled: boolean) => void;
  onEnableAll: () => void;
  onDisableAll: () => void;
  onReset: () => void;
}) {
  const [open, setOpen] = React.useState(false);
  const hiddenCount = Object.values(prefs.widgets).filter((v) => !v).length;

  if (!canCustomize) return null;

  const opsWidgets = DASHBOARD_WIDGET_META.filter((w) => w.group === "ops");
  const classicWidgets = DASHBOARD_WIDGET_META.filter((w) => w.group === "classic");
  const sharedWidgets = DASHBOARD_WIDGET_META.filter((w) => w.group === "shared");

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        render={
          <Button variant="outline" size="sm" type="button" className="gap-1.5">
            <Settings2 className="h-3.5 w-3.5" />
            Layout
            {hiddenCount > 0 ? (
              <Badge variant="secondary" className="h-4 px-1 text-[10px] font-normal">
                {hiddenCount} off
              </Badge>
            ) : null}
          </Button>
        }
      />
      <SheetContent side="right" className="flex w-full flex-col gap-0 sm:max-w-md">
        <SheetHeader className="border-b pb-4">
          <SheetTitle>Dashboard settings</SheetTitle>
          <SheetDescription>
            Pick a board view, preview how employees see Overview, and toggle cards on or off.
            Saved on this browser.
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 space-y-6 overflow-y-auto px-4 py-4">
          <section className="space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Board view
            </h3>
            <Select
              value={prefs.viewMode}
              onValueChange={(v) => {
                if (!v) return;
                onViewModeChange(v as DashboardViewMode);
              }}
            >
              <SelectTrigger size="sm" className="w-full">
                <SelectValue>
                  {selectTriggerLabelByKey(prefs.viewMode, VIEW_OPTIONS) ?? undefined}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {DASHBOARD_VIEW_MODE_OPTIONS.map((opt) => (
                  <SelectItem key={opt.key} value={opt.key}>
                    <div className="flex flex-col gap-0.5 py-0.5">
                      <span>{opt.label}</span>
                      <span className="text-[11px] font-normal text-muted-foreground">
                        {opt.description}
                      </span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </section>

          <section className="space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Preview as role
            </h3>
            <p className="text-xs text-muted-foreground">
              See the board the way a teammate with that CRM role would — without changing their
              access.
            </p>
            <Select
              value={prefs.previewRole ?? "none"}
              onValueChange={(v) => {
                if (!v || v === "none") onPreviewRoleChange(null);
                else onPreviewRoleChange(v as Role);
              }}
            >
              <SelectTrigger size="sm" className="w-full">
                <SelectValue>
                  {prefs.previewRole
                    ? roleLabel(prefs.previewRole)
                    : "Off — use my role"}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Off — use my role</SelectItem>
                {PREVIEW_ROLES.map((role) => (
                  <SelectItem key={role} value={role}>
                    {roleLabel(role)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </section>

          <section className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Visible cards
              </h3>
              <div className="flex gap-1">
                <Button type="button" variant="ghost" size="xs" onClick={onEnableAll}>
                  All on
                </Button>
                <Button type="button" variant="ghost" size="xs" onClick={onDisableAll}>
                  All off
                </Button>
              </div>
            </div>

            <WidgetGroup title="Owner ops" items={opsWidgets} prefs={prefs} onChange={onWidgetChange} />
            <WidgetGroup title="Shared" items={sharedWidgets} prefs={prefs} onChange={onWidgetChange} />
            <WidgetGroup
              title="Classic / pipeline"
              items={classicWidgets}
              prefs={prefs}
              onChange={onWidgetChange}
            />
          </section>
        </div>

        <div className="border-t p-4">
          <Button type="button" variant="outline" size="sm" className="w-full" onClick={onReset}>
            Reset to defaults
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function WidgetGroup({
  title,
  items,
  prefs,
  onChange,
}: {
  title: string;
  items: typeof DASHBOARD_WIDGET_META;
  prefs: DashboardPreferences;
  onChange: (key: DashboardWidgetKey, enabled: boolean) => void;
}) {
  return (
    <div className="space-y-2 rounded-lg border p-3">
      <p className="text-[11px] font-medium text-muted-foreground">{title}</p>
      <ul className="space-y-2.5">
        {items.map((item) => (
          <li key={item.key} className="flex items-center justify-between gap-3">
            <Label htmlFor={`dash-w-${item.key}`} className="cursor-pointer text-sm font-normal">
              {item.label}
            </Label>
            <Switch
              id={`dash-w-${item.key}`}
              size="sm"
              checked={prefs.widgets[item.key]}
              onCheckedChange={(checked) => onChange(item.key, Boolean(checked))}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}
