"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useWorkspace } from "@/components/providers/workspace-mode-provider";
import { canManageFeatureGrants } from "@/lib/can-manage-feature-grants";
import type { AdminFeatureKey } from "@/lib/admin-features";
import { isFirebaseWebConfigured } from "@/lib/firebase/config";
import { FeatureGrantsEditor } from "@/components/admin/feature-grants-editor";
import { toast } from "sonner";

function memberLabel(u: { id: string; displayName: string; email: string }): string {
  const name = u.displayName?.trim();
  if (name && name !== u.id) return name;
  return u.email?.trim() || u.id;
}

export function FeatureGrantsPanel() {
  const { users, currentUserId, getUserById, patchUser, mode, isDemo } = useWorkspace();
  const viewer = getUserById(currentUserId);
  const canEdit = canManageFeatureGrants(viewer);

  const [userId, setUserId] = React.useState("");
  const [grants, setGrants] = React.useState<AdminFeatureKey[]>([]);
  const [saving, setSaving] = React.useState(false);

  const target = users.find((u) => u.id === userId);

  React.useEffect(() => {
    if (!target) {
      setGrants([]);
      return;
    }
    setGrants(target.featureGrants ?? []);
  }, [target?.id, target?.featureGrants]);

  if (!canEdit) return null;

  async function handleSave() {
    if (!userId || !target) return;
    setSaving(true);
    const writeLive = mode === "live" && !isDemo && isFirebaseWebConfigured();
    if (writeLive) {
      const res = await fetch("/api/org/workspace-users", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, featureGrants: grants }),
      });
      const data = (await res.json()) as { error?: unknown };
      if (!res.ok) {
        const msg =
          typeof data.error === "string"
            ? data.error
            : JSON.stringify(data.error ?? "Save failed");
        toast.error(msg);
        setSaving(false);
        return;
      }
    }
    patchUser(userId, { featureGrants: grants.length ? grants : undefined });
    toast.success("Feature access updated");
    setSaving(false);
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Feature access</CardTitle>
        <CardDescription>
          Grant admin tools (Import, Scrapers, AI, etc.) without changing CRM permissions. Manage the same
          settings on the Users page when editing a person.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1.5 max-w-sm">
          <Label className="text-xs">Team member</Label>
          <Select value={userId || undefined} onValueChange={(v) => setUserId(v ?? "")}>
            <SelectTrigger className="h-9">
              <SelectValue placeholder="Select user" />
            </SelectTrigger>
            <SelectContent>
              {users.map((u) => (
                <SelectItem key={u.id} value={u.id}>
                  {memberLabel(u)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {target ? (
          <>
            <FeatureGrantsEditor
              user={target}
              value={grants}
              onChange={setGrants}
              disabled={saving}
            />
            <Button size="sm" onClick={() => void handleSave()} disabled={saving || !userId}>
              {saving ? "Saving…" : "Save feature access"}
            </Button>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">Choose a user to edit their feature access.</p>
        )}
      </CardContent>
    </Card>
  );
}
