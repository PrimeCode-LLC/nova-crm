"use client";

import * as React from "react";
import { PageBody, PageHeader } from "@/components/common/page-header";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { ChannelChip } from "@/components/common/channel-chip";
import { CHANNEL_FUNNELS, CHANNEL_LIST } from "@/lib/constants";
import type { ChannelKey } from "@/lib/types";
import { Settings, Plus, Radio, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  useChannelAdminStore,
  parseStagesInput,
  type CustomChannelRow,
} from "@/stores/channel-admin-store";
import { pushChannelAdminConfigToServer } from "@/lib/channel-admin-server-sync";

async function syncChannelsToWorkspace(): Promise<boolean> {
  const r = await pushChannelAdminConfigToServer();
  if (!r.ok) {
    toast.error("Could not save channels to the workspace", { description: r.error });
    return false;
  }
  return true;
}
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import { useAuth } from "@/components/providers/auth-provider";
import { useWorkspace } from "@/components/providers/workspace-mode-provider";
import { useUserDoc } from "@/lib/hooks/use-user-doc";
import { isAuthDisabled } from "@/lib/auth/flags";
import { roleAtLeast } from "@/lib/platform/org-role";

const CHANNEL_DESCRIPTIONS: Record<ChannelKey, string> = {
  cold_email: "Mass outbound email campaigns via Instantly. High volume, low personalization.",
  personalized_email: "1:1 hand-crafted outreach. Low volume, high intent signal.",
  linkedin_outbound: "Connection requests + message sequences on LinkedIn.",
  linkedin_1to1: "Direct messages to first-degree connections. Warm approach.",
  website_form: "Inbound leads from website contact forms or chatbot.",
  upwork: "Proposal submissions on Upwork platform.",
  job_apply: "CV-based outreach applied to job postings as a lead-gen strategy.",
};

type ConfigureTarget =
  | { kind: "builtin"; key: ChannelKey }
  | { kind: "custom"; id: string }
  | null;

function openAddCustomDialog(setOpen: (v: boolean) => void) {
  setOpen(true);
}

export default function AdminChannelsPage() {
  const { user } = useAuth();
  const { isDemo } = useWorkspace();
  const { data: userDoc } = useUserDoc(
    isDemo || isAuthDisabled() || !user ? undefined : user.uid,
  );
  const isWorkspaceAdmin =
    isDemo ||
    (userDoc?.orgRole !== undefined && roleAtLeast(userDoc.orgRole, "admin"));

  const autoMap = useChannelAdminStore((s) => s.autoMap);
  const setAuto = useChannelAdminStore((s) => s.setAuto);
  const descriptionOverrides = useChannelAdminStore((s) => s.descriptionOverrides);
  const setDescriptionOverride = useChannelAdminStore((s) => s.setDescriptionOverride);
  const customChannels = useChannelAdminStore((s) => s.customChannels);
  const addCustomChannel = useChannelAdminStore((s) => s.addCustomChannel);
  const updateCustomChannel = useChannelAdminStore((s) => s.updateCustomChannel);
  const removeCustomChannel = useChannelAdminStore((s) => s.removeCustomChannel);

  const [addOpen, setAddOpen] = React.useState(false);
  const [configure, setConfigure] = React.useState<ConfigureTarget>(null);
  const [deleteCustomId, setDeleteCustomId] = React.useState<string | null>(null);

  const [newName, setNewName] = React.useState("");
  const [newDescription, setNewDescription] = React.useState("");
  const [newStages, setNewStages] = React.useState("Lead\nContacted\nMeeting\nClosed");
  const [newAuto, setNewAuto] = React.useState(false);

  const resetAddForm = React.useCallback(() => {
    setNewName("");
    setNewDescription("");
    setNewStages("Lead\nContacted\nMeeting\nClosed");
    setNewAuto(false);
  }, []);

  const handleAddCustom = React.useCallback(async () => {
    const name = newName.trim();
    if (!name) {
      toast.error("Enter a channel name.");
      return;
    }
    const stages = parseStagesInput(newStages);
    if (stages.length === 0) {
      toast.error("Add at least one funnel stage (one per line or comma-separated).");
      return;
    }
    addCustomChannel({
      name,
      description: newDescription.trim(),
      stages,
      auto: newAuto,
    });
    const saved = await syncChannelsToWorkspace();
    if (saved) toast.success(`Custom channel “${name}” added.`);
    setAddOpen(false);
    resetAddForm();
  }, [addCustomChannel, newDescription, newName, newStages, newAuto, resetAddForm]);

  return (
    <>
      <PageHeader
        title="Channels"
        description="Configure outreach channels, funnel stages, and automation rules."
        actions={
          <Button variant="outline" size="sm" onClick={() => openAddCustomDialog(setAddOpen)}>
            <Plus className="h-3.5 w-3.5" /> Add custom channel
          </Button>
        }
      />
      <PageBody>
        <div className="rounded-md border overflow-hidden divide-y">
          {CHANNEL_LIST.map((ch) => {
            const funnelStages = CHANNEL_FUNNELS[ch.key];
            const description =
              descriptionOverrides[ch.key] ?? CHANNEL_DESCRIPTIONS[ch.key];
            return (
              <div
                key={ch.key}
                className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4 px-4 py-3 hover:bg-muted/20 transition-colors"
              >
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  <ChannelChip channel={ch.key} />
                  <div className="min-w-0">
                    <div className="text-sm font-medium">{ch.label}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">{description}</div>
                  </div>
                </div>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4 shrink-0">
                  <div className="flex sm:hidden items-center gap-1.5 overflow-x-auto pb-1 -mb-1 scrollbar-thin">
                    {funnelStages.map((s, i) => (
                      <React.Fragment key={s.key}>
                        <Badge variant="outline" className="text-[10px] font-normal px-1.5 py-0 shrink-0">
                          {s.label}
                        </Badge>
                        {i < funnelStages.length - 1 && (
                          <span className="text-muted-foreground/40 text-[10px] shrink-0">→</span>
                        )}
                      </React.Fragment>
                    ))}
                  </div>
                  <div className="hidden sm:flex items-center gap-1.5 flex-wrap max-w-[260px]">
                    {funnelStages.map((s, i) => (
                      <React.Fragment key={s.key}>
                        <Badge variant="outline" className="text-[10px] font-normal px-1.5 py-0">
                          {s.label}
                        </Badge>
                        {i < funnelStages.length - 1 && (
                          <span className="text-muted-foreground/40 text-[10px]">→</span>
                        )}
                      </React.Fragment>
                    ))}
                  </div>
                  <div className="flex items-center gap-2 justify-between sm:justify-start">
                    <span className="text-xs text-muted-foreground">Auto</span>
                    <Switch
                      checked={autoMap[ch.key]}
                      disabled={!isWorkspaceAdmin}
                      title={!isWorkspaceAdmin ? "Only workspace admins can change built-in channels." : undefined}
                      onCheckedChange={(v) => {
                        setAuto(ch.key, !!v);
                        toast.success(`${ch.label}: auto ${v ? "enabled" : "disabled"}`);
                      }}
                    />
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 ml-auto sm:ml-0"
                      disabled={!isWorkspaceAdmin}
                      title={!isWorkspaceAdmin ? "Only workspace admins can configure built-in channels." : undefined}
                      onClick={() => setConfigure({ kind: "builtin", key: ch.key })}
                    >
                      <Settings className="h-3.5 w-3.5" /> Configure
                    </Button>
                  </div>
                </div>
              </div>
            );
          })}

          {customChannels.map((c) => (
            <CustomChannelListRow
              key={c.id}
              channel={c}
              onConfigure={() => setConfigure({ kind: "custom", id: c.id })}
              onToggleAuto={(v) => {
                updateCustomChannel(c.id, { auto: v });
                void syncChannelsToWorkspace().then((ok) => {
                  if (ok) toast.success(`${c.name}: auto ${v ? "enabled" : "disabled"}`);
                });
              }}
              onDelete={() => setDeleteCustomId(c.id)}
              canDelete={isWorkspaceAdmin}
            />
          ))}
        </div>

        <Card className="bg-muted/20">
          <CardContent className="p-4">
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-2">
              Custom channels
            </div>
            <p className="text-sm text-muted-foreground">
              You can define custom channels with their own funnel stages and automation rules.
              Custom channels appear here alongside built-in ones. They are saved to the workspace so
              everyone sees the same list and Activity can show the channel name (not only on the
              person who created it).
            </p>
            <Button variant="outline" size="sm" className="mt-3" onClick={() => openAddCustomDialog(setAddOpen)}>
              <Plus className="h-3.5 w-3.5" /> Add custom channel
            </Button>
          </CardContent>
        </Card>
      </PageBody>

      <Dialog
        open={addOpen}
        onOpenChange={(o) => {
          setAddOpen(o);
          if (!o) resetAddForm();
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add custom channel</DialogTitle>
            <DialogDescription>
              Name your channel, describe it for the team, and list funnel stages in order.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 py-1">
            <div className="grid gap-1.5">
              <Label htmlFor="cc-name">Name</Label>
              <Input
                id="cc-name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="e.g. Twitter DMs"
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="cc-desc">Description</Label>
              <Textarea
                id="cc-desc"
                value={newDescription}
                onChange={(e) => setNewDescription(e.target.value)}
                placeholder="Short note on when to use this channel"
                className="min-h-[72px]"
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="cc-stages">Funnel stages</Label>
              <Textarea
                id="cc-stages"
                value={newStages}
                onChange={(e) => setNewStages(e.target.value)}
                placeholder={"One per line, e.g.\nSent\nReplied\nWon"}
                className="min-h-[100px] font-mono text-xs"
              />
              <p className="text-[11px] text-muted-foreground">Separate with new lines or commas.</p>
            </div>
            <div className="flex items-center justify-between gap-2 rounded-md border px-3 py-2">
              <span className="text-sm">Automation</span>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">Auto</span>
                <Switch checked={newAuto} onCheckedChange={setNewAuto} />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setAddOpen(false)}>
              Cancel
            </Button>
            <Button type="button" onClick={handleAddCustom}>
              Create channel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ChannelConfigureSheet
        target={configure}
        onOpenChange={(open) => {
          if (!open) setConfigure(null);
        }}
        descriptionDefaults={CHANNEL_DESCRIPTIONS}
        descriptionOverrides={descriptionOverrides}
        setDescriptionOverride={setDescriptionOverride}
        autoMap={autoMap}
        setAuto={setAuto}
        customChannels={customChannels}
        updateCustomChannel={updateCustomChannel}
        removeCustomChannel={removeCustomChannel}
        canDeleteCustomChannels={isWorkspaceAdmin}
      />

      <AlertDialog open={!!deleteCustomId && isWorkspaceAdmin} onOpenChange={(open) => !open && setDeleteCustomId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this channel?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the custom channel from your workspace. Built-in channels are not affected.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (deleteCustomId) {
                  removeCustomChannel(deleteCustomId);
                  void syncChannelsToWorkspace().then((ok) => {
                    if (ok) toast.success("Custom channel removed.");
                  });
                  setDeleteCustomId(null);
                  setConfigure((cur) =>
                    cur?.kind === "custom" && cur.id === deleteCustomId ? null : cur,
                  );
                }
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function CustomChannelListRow({
  channel,
  onConfigure,
  onToggleAuto,
  onDelete,
  canDelete,
}: {
  channel: CustomChannelRow;
  onConfigure: () => void;
  onToggleAuto: (v: boolean) => void;
  onDelete: () => void;
  canDelete: boolean;
}) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4 px-4 py-3 hover:bg-muted/20 transition-colors">
      <div className="flex items-center gap-3 flex-1 min-w-0">
        <Badge
          variant="outline"
          className={cn(
            "rounded-md font-medium gap-1.5 px-1.5 py-0.5 shrink-0",
            "text-muted-foreground bg-muted/40 border-border",
          )}
        >
          <Radio className="h-3 w-3" />
          <span className="max-w-[4rem] truncate">{channel.name}</span>
        </Badge>
        <div className="min-w-0">
          <div className="text-sm font-medium">{channel.name}</div>
          <div className="text-xs text-muted-foreground mt-0.5">
            {channel.description || "Custom outreach channel."}
          </div>
        </div>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4 shrink-0">
        <div className="flex sm:hidden items-center gap-1.5 overflow-x-auto pb-1 -mb-1 scrollbar-thin">
          {channel.stages.map((s, i) => (
            <React.Fragment key={`${channel.id}-${s.key}-${i}`}>
              <Badge variant="outline" className="text-[10px] font-normal px-1.5 py-0 shrink-0">
                {s.label}
              </Badge>
              {i < channel.stages.length - 1 && (
                <span className="text-muted-foreground/40 text-[10px] shrink-0">→</span>
              )}
            </React.Fragment>
          ))}
        </div>
        <div className="hidden sm:flex items-center gap-1.5 flex-wrap max-w-[260px]">
          {channel.stages.map((s, i) => (
            <React.Fragment key={`${channel.id}-d-${s.key}-${i}`}>
              <Badge variant="outline" className="text-[10px] font-normal px-1.5 py-0">
                {s.label}
              </Badge>
              {i < channel.stages.length - 1 && (
                <span className="text-muted-foreground/40 text-[10px]">→</span>
              )}
            </React.Fragment>
          ))}
        </div>
        <div className="flex items-center gap-2 justify-between sm:justify-start">
          <span className="text-xs text-muted-foreground">Auto</span>
          <Switch checked={channel.auto} onCheckedChange={onToggleAuto} />
          <Button variant="outline" size="sm" className="h-7 ml-auto sm:ml-0" onClick={onConfigure}>
            <Settings className="h-3.5 w-3.5" /> Configure
          </Button>
          {canDelete ? (
            <Button
              variant="ghost"
              size="icon-sm"
              className="text-muted-foreground hover:text-destructive shrink-0"
              aria-label={`Delete ${channel.name}`}
              onClick={onDelete}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function ChannelConfigureSheet({
  target,
  onOpenChange,
  descriptionDefaults,
  descriptionOverrides,
  setDescriptionOverride,
  autoMap,
  setAuto,
  customChannels,
  updateCustomChannel,
  removeCustomChannel,
  canDeleteCustomChannels,
}: {
  target: ConfigureTarget;
  onOpenChange: (open: boolean) => void;
  descriptionDefaults: Record<ChannelKey, string>;
  descriptionOverrides: Partial<Record<ChannelKey, string>>;
  setDescriptionOverride: (key: ChannelKey, value: string | undefined) => void;
  autoMap: Record<ChannelKey, boolean>;
  setAuto: (key: ChannelKey, value: boolean) => void;
  customChannels: CustomChannelRow[];
  updateCustomChannel: (id: string, patch: Partial<Omit<CustomChannelRow, "id">>) => void;
  removeCustomChannel: (id: string) => void;
  canDeleteCustomChannels: boolean;
}) {
  const open = target != null;
  const customRow =
    target?.kind === "custom" ? customChannels.find((c) => c.id === target.id) : undefined;

  const formKey =
    target?.kind === "builtin"
      ? `builtin:${target.key}`
      :     target?.kind === "custom" && customRow
        ? `custom:${customRow.id}`
        : null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-md overflow-y-auto">
        {target?.kind === "builtin" && (
          <ConfigureBuiltinChannelForm
            key={formKey ?? "none"}
            channelKey={target.key}
            channelLabel={CHANNEL_LIST.find((c) => c.key === target.key)?.label ?? target.key}
            defaultDescription={descriptionDefaults[target.key]}
            initialDescription={descriptionOverrides[target.key] ?? descriptionDefaults[target.key]}
            initialAuto={autoMap[target.key]}
            onClose={() => onOpenChange(false)}
            setDescriptionOverride={setDescriptionOverride}
            setAuto={setAuto}
          />
        )}
        {target?.kind === "custom" && customRow && (
          <ConfigureCustomChannelForm
            key={formKey ?? "none"}
            channel={customRow}
            onClose={() => onOpenChange(false)}
            updateCustomChannel={updateCustomChannel}
            removeCustomChannel={removeCustomChannel}
            canDelete={canDeleteCustomChannels}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}

function ConfigureBuiltinChannelForm({
  channelKey,
  channelLabel,
  defaultDescription,
  initialDescription,
  initialAuto,
  onClose,
  setDescriptionOverride,
  setAuto,
}: {
  channelKey: ChannelKey;
  channelLabel: string;
  defaultDescription: string;
  initialDescription: string;
  initialAuto: boolean;
  onClose: () => void;
  setDescriptionOverride: (key: ChannelKey, value: string | undefined) => void;
  setAuto: (key: ChannelKey, value: boolean) => void;
}) {
  const [draftDesc, setDraftDesc] = React.useState(initialDescription);
  const [draftAuto, setDraftAuto] = React.useState(initialAuto);

  const handleSave = () => {
    const trimmed = draftDesc.trim();
    if (trimmed === defaultDescription.trim()) setDescriptionOverride(channelKey, undefined);
    else setDescriptionOverride(channelKey, trimmed);
    setAuto(channelKey, draftAuto);
    toast.success("Channel settings saved.");
    onClose();
  };

  return (
    <>
      <SheetHeader>
        <SheetTitle>Configure: {channelLabel}</SheetTitle>
        <SheetDescription>
          Adjust how this channel is described in the list and whether automation runs.
        </SheetDescription>
      </SheetHeader>

      <div className="grid gap-4 px-1">
        <div className="rounded-md border bg-muted/20 p-3">
          <div className="text-xs font-medium text-muted-foreground mb-2">Funnel (reference)</div>
          <div className="flex flex-wrap items-center gap-1.5">
            {CHANNEL_FUNNELS[channelKey].map((s, i, arr) => (
              <React.Fragment key={s.key}>
                <Badge variant="secondary" className="text-[10px] font-normal">
                  {s.label}
                </Badge>
                {i < arr.length - 1 && <span className="text-muted-foreground/50 text-xs">→</span>}
              </React.Fragment>
            ))}
          </div>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="cfg-desc">Description</Label>
          <Textarea
            id="cfg-desc"
            value={draftDesc}
            onChange={(e) => setDraftDesc(e.target.value)}
            className="min-h-[100px]"
          />
        </div>
        <div className="flex items-center justify-between rounded-md border px-3 py-2">
          <div>
            <div className="text-sm font-medium">Automation</div>
            <div className="text-xs text-muted-foreground">Auto-advance / rules for this channel</div>
          </div>
          <Switch checked={draftAuto} onCheckedChange={setDraftAuto} />
        </div>
      </div>

      <SheetFooter className="border-t pt-4 sm:flex-row sm:justify-end gap-2">
        <Button type="button" variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button type="button" onClick={handleSave}>
          Save
        </Button>
      </SheetFooter>
    </>
  );
}

function ConfigureCustomChannelForm({
  channel,
  onClose,
  updateCustomChannel,
  removeCustomChannel,
  canDelete,
}: {
  channel: CustomChannelRow;
  onClose: () => void;
  updateCustomChannel: (id: string, patch: Partial<Omit<CustomChannelRow, "id">>) => void;
  removeCustomChannel: (id: string) => void;
  canDelete: boolean;
}) {
  const [draftName, setDraftName] = React.useState(channel.name);
  const [draftDesc, setDraftDesc] = React.useState(channel.description);
  const [draftStages, setDraftStages] = React.useState(channel.stages.map((s) => s.label).join("\n"));
  const [draftAuto, setDraftAuto] = React.useState(channel.auto);

  const handleSave = async () => {
    const stages = parseStagesInput(draftStages);
    if (stages.length === 0) {
      toast.error("Add at least one funnel stage.");
      return;
    }
    const name = draftName.trim();
    if (!name) {
      toast.error("Name is required.");
      return;
    }
    updateCustomChannel(channel.id, {
      name,
      description: draftDesc.trim(),
      stages,
      auto: draftAuto,
    });
    const ok = await syncChannelsToWorkspace();
    if (ok) toast.success("Custom channel updated.");
    onClose();
  };

  const handleDelete = async () => {
    removeCustomChannel(channel.id);
    const ok = await syncChannelsToWorkspace();
    if (ok) toast.success("Custom channel removed.");
    onClose();
  };

  return (
    <>
      <SheetHeader>
        <SheetTitle>Configure: {channel.name}</SheetTitle>
        <SheetDescription>
          Edit this custom channel. Changes apply immediately after you save.
        </SheetDescription>
      </SheetHeader>

      <div className="grid gap-4 px-1">
        <div className="grid gap-1.5">
          <Label htmlFor="cfg-name">Name</Label>
          <Input id="cfg-name" value={draftName} onChange={(e) => setDraftName(e.target.value)} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="cfg-cdesc">Description</Label>
          <Textarea
            id="cfg-cdesc"
            value={draftDesc}
            onChange={(e) => setDraftDesc(e.target.value)}
            className="min-h-[72px]"
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="cfg-stages">Funnel stages</Label>
          <Textarea
            id="cfg-stages"
            value={draftStages}
            onChange={(e) => setDraftStages(e.target.value)}
            className="min-h-[100px] font-mono text-xs"
          />
        </div>
        <div className="flex items-center justify-between rounded-md border px-3 py-2">
          <span className="text-sm">Auto</span>
          <Switch checked={draftAuto} onCheckedChange={setDraftAuto} />
        </div>
        {canDelete ? (
          <Button type="button" variant="outline" className="text-destructive" onClick={handleDelete}>
            Delete channel
          </Button>
        ) : null}
      </div>

      <SheetFooter className="border-t pt-4 sm:flex-row sm:justify-end gap-2">
        <Button type="button" variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button type="button" onClick={handleSave}>
          Save
        </Button>
      </SheetFooter>
    </>
  );
}
