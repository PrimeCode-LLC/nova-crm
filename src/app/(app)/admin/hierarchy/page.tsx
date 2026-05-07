"use client";

import * as React from "react";
import Link from "next/link";
import { PageBody, PageHeader } from "@/components/common/page-header";
import { Button } from "@/components/ui/button";
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
        ...(patch.managerId !== undefined ? { managerId: patch.managerId } : {}),
        ...(patch.departmentId !== undefined ? { departmentId: patch.departmentId } : {}),
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
        if (patch.managerId !== undefined) body.managerId = patch.managerId ?? null;
        if (patch.departmentId !== undefined) body.departmentId = patch.departmentId ?? null;
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
      if (patch.managerId !== undefined) demoPatch.managerId = patch.managerId;
      if (patch.departmentId !== undefined) demoPatch.departmentId = patch.departmentId;
      if (patch.roleId !== undefined) demoPatch.roleId = patch.roleId;
      patchUser(userId, demoPatch);
      toast.success("Org chart updated (this tab)");
    },
    [users, mode, patchUser, currentUserId],
  );

  return (
    <>
      <PageHeader
        title="Org hierarchy"
        description="Vertical or horizontal chart, drag-and-drop reporting lines, and quick edits for department and CRM role."
        actions={
          <Button variant="outline" size="sm" asChild>
            <Link href="/admin/users">
              <Users className="h-3.5 w-3.5" />
              Users table
            </Link>
          </Button>
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
