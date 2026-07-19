"use client";

import * as React from "react";
import { PageBody, PageHeader } from "@/components/common/page-header";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { ChannelChip } from "@/components/common/channel-chip";
import { UserChip } from "@/components/common/user-chip";
import { useWorkspace } from "@/components/providers/workspace-mode-provider";
import { useChannelOptions } from "@/hooks/use-channel-options";
import { buildWorkspaceOwnerPickerOptions } from "@/lib/owner-scope";
import { selectTriggerLabelById, selectTriggerLabelByKey } from "@/lib/base-ui-select-label";
import type { ChannelKey, Profile } from "@/lib/types";
import type { OpportunitySourceType } from "@/lib/ai/opportunity-fit-types";
import {
  ProfileFitCheckBadges,
  ProfileFitCheckFields,
} from "@/components/admin/profile-fit-check-fields";
import { profileFitCategories } from "@/lib/ai/profile-fit-check";
import { Plus, User } from "lucide-react";
import { toast } from "sonner";

function newProfileId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `p-${crypto.randomUUID()}`;
  }
  return `p-${Date.now()}`;
}

export default function AdminProfilesPage() {
  const {
    profiles,
    activityRecords,
    users,
    currentUserId,
    getOwnerDisplayName,
    updateProfile,
    addProfile,
  } = useWorkspace();
  const channelOptions = useChannelOptions();
  const [newOpen, setNewOpen] = React.useState(false);
  const [name, setName] = React.useState("");
  const [channel, setChannel] = React.useState<ChannelKey | "">("");
  const [ownerId, setOwnerId] = React.useState("");
  const [notes, setNotes] = React.useState("");
  const [stackLabel, setStackLabel] = React.useState("");
  const [fitCheckCategories, setFitCheckCategories] = React.useState<OpportunitySourceType[]>([]);
  const [knowledgeLibraryIds, setKnowledgeLibraryIds] = React.useState<string[]>([]);
  const [knowledgeDocumentIds, setKnowledgeDocumentIds] = React.useState<string[]>([]);
  const [loading, setLoading] = React.useState(false);

  const [detailOpen, setDetailOpen] = React.useState(false);
  const [detailId, setDetailId] = React.useState<string | null>(null);
  const [draftName, setDraftName] = React.useState("");
  const [draftChannel, setDraftChannel] = React.useState<ChannelKey | "">("");
  const [draftOwnerId, setDraftOwnerId] = React.useState("");
  const [draftNotes, setDraftNotes] = React.useState("");
  const [draftActive, setDraftActive] = React.useState(true);
  const [draftStackLabel, setDraftStackLabel] = React.useState("");
  const [draftFitCategories, setDraftFitCategories] = React.useState<OpportunitySourceType[]>([]);
  const [draftLibraryIds, setDraftLibraryIds] = React.useState<string[]>([]);
  const [draftDocumentIds, setDraftDocumentIds] = React.useState<string[]>([]);
  const [detailSaving, setDetailSaving] = React.useState(false);

  const weekMs = 7 * 24 * 60 * 60 * 1000;
  const [weekCutoff] = React.useState(() => Date.now() - weekMs);

  const newOwnerOptions = React.useMemo(
    () =>
      buildWorkspaceOwnerPickerOptions(
        users,
        currentUserId,
        getOwnerDisplayName,
        ownerId ? [ownerId] : [],
      ),
    [users, currentUserId, getOwnerDisplayName, ownerId],
  );

  const detailOwnerOptions = React.useMemo(
    () =>
      buildWorkspaceOwnerPickerOptions(users, currentUserId, getOwnerDisplayName, [
        draftOwnerId,
      ]),
    [users, currentUserId, getOwnerDisplayName, draftOwnerId],
  );

  const enriched = React.useMemo(
    () =>
      profiles.map((p) => ({
        ...p,
        weekActivity: activityRecords.filter(
          (a) =>
            a.profileId === p.id && new Date(a.occurredAt).getTime() >= weekCutoff,
        ).length,
      })),
    [profiles, activityRecords, weekCutoff],
  );

  const detailProfile = detailId ? enriched.find((p) => p.id === detailId) : undefined;

  function openDetail(profile: Profile) {
    setDetailId(profile.id);
    setDraftName(profile.name);
    setDraftChannel(profile.channel);
    setDraftOwnerId(profile.ownerId);
    setDraftNotes(profile.notes ?? "");
    setDraftActive(profile.active);
    setDraftStackLabel(profile.stackLabel ?? "");
    setDraftFitCategories(profile.fitCheckCategories ?? []);
    setDraftLibraryIds(profile.knowledgeLibraryIds ?? []);
    setDraftDocumentIds(profile.knowledgeDocumentIds ?? []);
    setDetailOpen(true);
  }

  function closeDetail() {
    setDetailOpen(false);
    setDetailId(null);
  }

  function handleDetailSave() {
    if (!detailId || !draftName.trim() || !draftChannel || !draftOwnerId) {
      toast.error("Name, channel, and owner are required.");
      return;
    }
    setDetailSaving(true);
    updateProfile(detailId, {
      name: draftName.trim(),
      channel: draftChannel as ChannelKey,
      ownerId: draftOwnerId,
      notes: draftNotes.trim() || undefined,
      active: draftActive,
      stackLabel: draftStackLabel.trim() || undefined,
      fitCheckCategories: draftFitCategories,
      knowledgeLibraryIds: draftLibraryIds,
      knowledgeDocumentIds: draftDocumentIds,
    });
    setDetailSaving(false);
    toast.success("Profile updated");
    closeDetail();
  }

  function handleCreate() {
    const missing: string[] = [];
    if (!name.trim()) missing.push("profile name");
    if (!channel) missing.push("channel");
    if (!ownerId) missing.push("owner");
    if (missing.length) {
      toast.error(`Please add: ${missing.join(", ")}.`);
      return;
    }
    setLoading(true);
    addProfile({
      id: newProfileId(),
      name: name.trim(),
      channel: channel as ChannelKey,
      ownerId,
      active: true,
      notes: notes.trim() || undefined,
      stackLabel: stackLabel.trim() || undefined,
      fitCheckCategories: fitCheckCategories.length ? fitCheckCategories : undefined,
      knowledgeLibraryIds: knowledgeLibraryIds.length ? knowledgeLibraryIds : undefined,
      knowledgeDocumentIds: knowledgeDocumentIds.length ? knowledgeDocumentIds : undefined,
    });
    setLoading(false);
    toast.success(`Profile "${name.trim()}" created`);
    setNewOpen(false);
    setName("");
    setChannel("");
    setOwnerId("");
    setNotes("");
    setStackLabel("");
    setFitCheckCategories([]);
    setKnowledgeLibraryIds([]);
    setKnowledgeDocumentIds([]);
  }

  return (
    <>
      <PageHeader
        title="Profiles"
        description="Outreach personas per channel. Assign Fit Check categories and knowledge libraries so each stack (MERN, .NET, etc.) gets the right answers."
        actions={
          <Button size="sm" onClick={() => setNewOpen(true)}>
            <Plus className="h-3.5 w-3.5" /> New profile
          </Button>
        }
      />
      <PageBody>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {enriched.map((p) => (
            <Card
              key={p.id}
              role="button"
              tabIndex={0}
              onClick={() => openDetail(p)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  openDetail(p);
                }
              }}
              className="hover:bg-muted/20 transition-colors cursor-pointer text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary/10 text-primary shrink-0">
                      <User className="h-4 w-4" />
                    </div>
                    <div className="min-w-0">
                      <CardTitle className="text-sm truncate">{p.name}</CardTitle>
                    </div>
                  </div>
                  <div
                    className="shrink-0"
                    onClick={(e) => e.stopPropagation()}
                    onKeyDown={(e) => e.stopPropagation()}
                  >
                    <Switch
                      checked={p.active}
                      onCheckedChange={(v) => {
                        updateProfile(p.id, { active: v });
                        toast.success(`${p.name}: ${v ? "activated" : "deactivated"}`);
                      }}
                    />
                  </div>
                </div>
              </CardHeader>
              <CardContent className="pt-0 space-y-3">
                <div className="flex items-center gap-2 flex-wrap">
                  <ChannelChip channel={p.channel} />
                  <ProfileFitCheckBadges
                    stackLabel={p.stackLabel}
                    fitCheckCategories={profileFitCategories(p)}
                    knowledgeLibraryCount={p.knowledgeLibraryIds?.length}
                    knowledgeDocumentCount={p.knowledgeDocumentIds?.length}
                  />
                  {!p.active && (
                    <Badge variant="outline" className="text-[10px] text-muted-foreground">
                      Inactive
                    </Badge>
                  )}
                </div>
                <div className="flex items-center justify-between text-xs">
                  <UserChip userId={p.ownerId} size="xs" />
                  <span className="text-muted-foreground tabular-nums">
                    <span className="font-medium text-foreground">{p.weekActivity}</span> this week
                  </span>
                </div>
                {p.notes && (
                  <p className="text-xs text-muted-foreground truncate">{p.notes}</p>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      </PageBody>

      <Dialog
        open={newOpen}
        onOpenChange={(open) => {
          setNewOpen(open);
          if (open && currentUserId) {
            setOwnerId((prev) => prev || currentUserId);
          }
        }}
      >
        <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <User className="h-4 w-4" /> New profile
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-1">
            <div className="space-y-1.5">
              <Label className="text-xs">Profile name</Label>
              <Input
                placeholder="e.g. Executive, LinkedIn outbound"
                className="h-9"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Channel</Label>
              <Select value={channel} onValueChange={(v) => setChannel((v ?? "") as ChannelKey)}>
                <SelectTrigger className="h-9">
                  <SelectValue placeholder="Channel">
                    {selectTriggerLabelByKey(channel, channelOptions) ?? undefined}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {channelOptions.map((c) => (
                    <SelectItem key={c.key} value={c.key}>
                      {c.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Owner</Label>
              <Select value={ownerId} onValueChange={(v) => setOwnerId(v ?? "")}>
                <SelectTrigger className="h-9">
                  <SelectValue placeholder="Select owner">
                    {selectTriggerLabelById(ownerId, newOwnerOptions) ??
                      (ownerId
                        ? getOwnerDisplayName(ownerId)?.trim() ||
                          users.find((u) => u.id === ownerId)?.displayName?.trim() ||
                          users.find((u) => u.id === ownerId)?.email?.split("@")[0]?.trim() ||
                          undefined
                        : undefined)}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {newOwnerOptions.map((o) => (
                    <SelectItem key={o.id} value={o.id}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Notes (optional)</Label>
              <Textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Any notes about this profile…"
                className="h-16 text-sm resize-none"
              />
            </div>
            {channel ? (
              <ProfileFitCheckFields
                channel={channel as ChannelKey}
                stackLabel={stackLabel}
                onStackLabelChange={setStackLabel}
                fitCheckCategories={fitCheckCategories}
                onFitCheckCategoriesChange={setFitCheckCategories}
                knowledgeLibraryIds={knowledgeLibraryIds}
                onKnowledgeLibraryIdsChange={setKnowledgeLibraryIds}
                knowledgeDocumentIds={knowledgeDocumentIds}
                onKnowledgeDocumentIdsChange={setKnowledgeDocumentIds}
              />
            ) : null}
          </div>
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setNewOpen(false)}>
              Cancel
            </Button>
            <Button size="sm" onClick={() => void handleCreate()} disabled={loading}>
              {loading ? "Creating…" : "Create profile"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Sheet
        open={detailOpen}
        onOpenChange={(open) => {
          if (!open) closeDetail();
        }}
      >
        <SheetContent side="right" className="flex w-full flex-col gap-0 sm:max-w-lg">
          <SheetHeader className="border-b pb-4 text-left">
            <SheetTitle>Edit profile</SheetTitle>
            <SheetDescription>
              {detailProfile ? (
                <>
                  <span className="font-medium text-foreground">{detailProfile.weekActivity}</span>{" "}
                  activities logged this week.
                </>
              ) : (
                "Loading…"
              )}
            </SheetDescription>
          </SheetHeader>
          {detailProfile && (
            <div className="flex flex-1 flex-col gap-4 overflow-y-auto py-4">
              <div className="space-y-1.5">
                <Label className="text-xs">Profile name</Label>
                <Input
                  className="h-9"
                  value={draftName}
                  onChange={(e) => setDraftName(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Channel</Label>
                <Select
                  value={draftChannel}
                  onValueChange={(v) => setDraftChannel((v ?? "") as ChannelKey)}
                >
                  <SelectTrigger className="h-9">
                    <SelectValue placeholder="Channel">
                      {selectTriggerLabelByKey(draftChannel, channelOptions) ?? undefined}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {channelOptions.map((c) => (
                      <SelectItem key={c.key} value={c.key}>
                        {c.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Owner</Label>
                <Select value={draftOwnerId} onValueChange={(v) => setDraftOwnerId(v ?? "")}>
                  <SelectTrigger className="h-9">
                    <SelectValue placeholder="Owner">
                      {selectTriggerLabelById(draftOwnerId, detailOwnerOptions) ??
                        (draftOwnerId
                          ? getOwnerDisplayName(draftOwnerId)?.trim() ||
                            users.find((u) => u.id === draftOwnerId)?.displayName?.trim() ||
                            users.find((u) => u.id === draftOwnerId)?.email?.split("@")[0]?.trim() ||
                            undefined
                          : undefined)}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {detailOwnerOptions.map((o) => (
                      <SelectItem key={o.id} value={o.id}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Notes</Label>
                <Textarea
                  value={draftNotes}
                  onChange={(e) => setDraftNotes(e.target.value)}
                  className="min-h-[80px] text-sm resize-none"
                />
              </div>
              <div className="flex items-center justify-between rounded-lg border px-3 py-2">
                <div>
                  <p className="text-sm font-medium">Active</p>
                  <p className="text-xs text-muted-foreground">Include in routing and reports</p>
                </div>
                <Switch checked={draftActive} onCheckedChange={setDraftActive} />
              </div>
              {draftChannel ? (
                <ProfileFitCheckFields
                  channel={draftChannel as ChannelKey}
                  stackLabel={draftStackLabel}
                  onStackLabelChange={setDraftStackLabel}
                  fitCheckCategories={draftFitCategories}
                  onFitCheckCategoriesChange={setDraftFitCategories}
                  knowledgeLibraryIds={draftLibraryIds}
                  onKnowledgeLibraryIdsChange={setDraftLibraryIds}
                  knowledgeDocumentIds={draftDocumentIds}
                  onKnowledgeDocumentIdsChange={setDraftDocumentIds}
                />
              ) : null}
            </div>
          )}
          <SheetFooter className="mt-auto border-t pt-4">
            <Button variant="ghost" size="sm" onClick={closeDetail}>
              Cancel
            </Button>
            <Button size="sm" disabled={detailSaving || !detailProfile} onClick={() => void handleDetailSave()}>
              {detailSaving ? "Saving…" : "Save changes"}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </>
  );
}
