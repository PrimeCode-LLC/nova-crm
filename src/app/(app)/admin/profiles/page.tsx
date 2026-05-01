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
import { ChannelChip } from "@/components/common/channel-chip";
import { UserChip } from "@/components/common/user-chip";
import { mockProfiles, mockActivityRecords, mockUsers } from "@/lib/mock-data";
import { CHANNELS, CHANNEL_LIST } from "@/lib/constants";
import type { ChannelKey } from "@/lib/types";
import { Plus, User } from "lucide-react";
import { toast } from "sonner";

const PROFILE_TYPES = ["upwork", "cv", "email", "linkedin"] as const;

export default function AdminProfilesPage() {
  const [newOpen, setNewOpen] = React.useState(false);
  const [name, setName] = React.useState("");
  const [channel, setChannel] = React.useState<ChannelKey | "">("");
  const [type, setType] = React.useState("");
  const [ownerId, setOwnerId] = React.useState("");
  const [notes, setNotes] = React.useState("");
  const [loading, setLoading] = React.useState(false);

  const now = Date.now();
  const weekMs = 7 * 24 * 60 * 60 * 1000;

  const enriched = mockProfiles.map((p) => ({
    ...p,
    weekActivity: mockActivityRecords.filter(
      (a) =>
        a.profileId === p.id &&
        new Date(a.occurredAt).getTime() >= now - weekMs,
    ).length,
  }));

  async function handleCreate() {
    if (!name || !channel || !type || !ownerId) {
      toast.error("All required fields missing");
      return;
    }
    setLoading(true);
    await new Promise((r) => setTimeout(r, 800));
    setLoading(false);
    toast.success(`Profile "${name}" created`);
    setNewOpen(false);
    setName(""); setChannel(""); setType(""); setOwnerId(""); setNotes("");
  }

  return (
    <>
      <PageHeader
        title="Profiles"
        description="Outreach personas — Upwork accounts, CVs, email inboxes, LinkedIn profiles."
        actions={
          <Button size="sm" onClick={() => setNewOpen(true)}>
            <Plus className="h-3.5 w-3.5" /> New profile
          </Button>
        }
      />
      <PageBody>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {enriched.map((p) => (
            <Card key={p.id} className="hover:bg-muted/20 transition-colors">
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
                  <Switch
                    checked={p.active}
                    onCheckedChange={() =>
                      toast.success(`${p.name}: ${p.active ? "deactivated" : "activated"}`)
                    }
                  />
                </div>
              </CardHeader>
              <CardContent className="pt-0 space-y-3">
                <div className="flex items-center gap-2">
                  <ChannelChip channel={p.channel} />
                  <Badge variant="outline" className="text-[10px] capitalize">
                    {p.type}
                  </Badge>
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

      <Dialog open={newOpen} onOpenChange={setNewOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <User className="h-4 w-4" /> New profile
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-1">
            <div className="space-y-1.5">
              <Label className="text-xs">Profile name</Label>
              <Input
                placeholder="e.g. Ali on LinkedIn"
                className="h-9"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Channel</Label>
                <Select value={channel} onValueChange={(v) => setChannel((v ?? "") as ChannelKey)}>
                  <SelectTrigger className="h-9">
                    <SelectValue placeholder="Channel" />
                  </SelectTrigger>
                  <SelectContent>
                    {CHANNEL_LIST.map((c) => (
                      <SelectItem key={c.key} value={c.key}>
                        {c.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Type</Label>
                <Select value={type} onValueChange={(v) => setType(v ?? "")}>
                  <SelectTrigger className="h-9">
                    <SelectValue placeholder="Type" />
                  </SelectTrigger>
                  <SelectContent>
                    {PROFILE_TYPES.map((t) => (
                      <SelectItem key={t} value={t} className="capitalize">
                        {t}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Owner</Label>
              <Select value={ownerId} onValueChange={(v) => setOwnerId(v ?? "")}>
                <SelectTrigger className="h-9">
                  <SelectValue placeholder="Select owner" />
                </SelectTrigger>
                <SelectContent>
                  {mockUsers.map((u) => (
                    <SelectItem key={u.id} value={u.id}>
                      {u.displayName}
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
          </div>
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setNewOpen(false)}>
              Cancel
            </Button>
            <Button size="sm" onClick={handleCreate} disabled={loading}>
              {loading ? "Creating…" : "Create profile"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
