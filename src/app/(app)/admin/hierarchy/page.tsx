"use client";

import * as React from "react";
import Link from "next/link";
import { PageBody, PageHeader } from "@/components/common/page-header";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { UserHierarchyPanel, type HierarchyPersistPayload } from "@/components/admin/user-hierarchy-panel";
import { useWorkspace } from "@/components/providers/workspace-mode-provider";
import { canManageOrgHierarchy } from "@/lib/can-manage-org-users";
import { managerAssignmentCreatesCycle } from "@/lib/user-hierarchy-tree";
import { isFirebaseWebConfigured } from "@/lib/firebase/config";
import { toast } from "sonner";
import { Users } from "lucide-react";
import type { User } from "@/lib/types";

export default function AdminHierarchyPage() {
  const { users, departments, patchUser, mode, currentUserId, getUserById } = useWorkspace();
  const viewer = getUserById(currentUserId);
  const canEdit = canManageOrgHierarchy(viewer);

  const persist = React.useCallback(
    async (userId: string, patch: HierarchyPersistPayload) => {
      const prev = users.find((u) => u.id === userId);
      if (!prev) return;

      const merged = {
        ...prev,
        ...("managerId" in patch ? { managerId: patch.managerId ?? undefined } : {}),
        ...("departmentId" in patch ? { departmentId: patch.departmentId ?? undefined } : {}),
        ...(patch.roleId !== undefined ? { roleId: patch.roleId } : {}),
      };
      const nextUsers = users.map((u) => (u.id === userId ? merged : u));

      const effectiveManager = merged.managerId;
      if (managerAssignmentCreatesCycle(nextUsers, userId, effectiveManager)) {
        toast.error("That manager would create a reporting loop.");
        return;
      }

      const writeFs = mode === "live" && isFirebaseWebConfigured();
      if (writeFs) {
        const body: Record<string, unknown> = { userId };
        if ("managerId" in patch) body.managerId = patch.managerId ?? null;
        if ("departmentId" in patch) body.departmentId = patch.departmentId ?? null;
        if (userId !== currentUserId && patch.roleId !== undefined) {
          body.roleId = patch.roleId;
        }
        if (Object.keys(body).length <= 1) return;

        const res = await fetch("/api/org/workspace-users", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const data = (await res.json()) as { error?: unknown };
        if (!res.ok) {
          const msg =
            typeof data.error === "string"
              ? data.error
              : JSON.stringify(data.error ?? "Update failed");
          toast.error(msg);
          return;
        }
        toast.success("Org chart updated");
        return;
      }

      const demoPatch: Partial<Omit<User, "id">> = {};
      if ("managerId" in patch) demoPatch.managerId = patch.managerId ?? undefined;
      if ("departmentId" in patch) demoPatch.departmentId = patch.departmentId ?? undefined;
      if (patch.roleId !== undefined) demoPatch.roleId = patch.roleId;
      patchUser(userId, demoPatch);
      toast.success("Org chart updated (this tab)");
    },
    [users, mode, patchUser, currentUserId],
  );

  /** Keep `managerAncestorIds` in Firestore aligned with reporting lines (required for manager CRM + inbox access). */
  React.useEffect(() => {
    if (!canEdit || mode !== "live" || !isFirebaseWebConfigured()) return;
    let cancelled = false;
    void fetch("/api/org/repair-hierarchy", { method: "POST", credentials: "same-origin" })
      .then((res) => {
        if (!res.ok && !cancelled) {
          console.warn("[hierarchy] repair-hierarchy failed", res.status);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [canEdit, mode]);

  return (
    <>
      <PageHeader
        title="Org hierarchy"
        description="Vertical or horizontal chart, drag-and-drop reporting lines, and quick edits for department and CRM role. People above someone in this tree can see that person’s leads, deals, and activity in the CRM."
        actions={
          <Link
            href="/admin/people"
            className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
          >
            <Users className="h-3.5 w-3.5" />
            People table
          </Link>
        }
      />
      <PageBody>
        <UserHierarchyPanel
          users={users}
          departments={departments}
          currentUserId={currentUserId}
          canEdit={canEdit}
          onPersist={persist}
        />
      </PageBody>
    </>
  );
}
