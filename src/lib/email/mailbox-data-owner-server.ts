import { viewerHasMailboxDelegationServer } from "@/lib/email/mailbox-delegation-server";
import {
  getMailboxProfileServer,
  viewerHasAssignedMailboxOnHostServer,
} from "@/lib/email/mailbox-profiles-server";
import { getMemberServer } from "@/lib/platform/members-server";
import {
  listOrgUsersServer,
  viewerManagesUserServer,
} from "@/lib/platform/hierarchy-access-server";
import { roleAtLeast } from "@/lib/platform/org-role";
import type { OrgMemberRole } from "@/lib/types";

export type MailboxAccessPermission = "view" | "send" | "manage_settings";

export type MailboxAccessResolved = {
  ok: true;
  dataOwnerUid: string;
  viewerIsMailboxOwner: boolean;
  permissions: MailboxAccessPermission[];
};

function allMailboxPermissions(): MailboxAccessPermission[] {
  return ["view", "send", "manage_settings"];
}

export function canMailboxView(resolved: MailboxAccessResolved): boolean {
  return resolved.permissions.includes("view");
}

export function canMailboxSend(resolved: MailboxAccessResolved): boolean {
  return resolved.permissions.includes("send");
}

export function mailboxReadOnlyForClient(resolved: MailboxAccessResolved): boolean {
  return !canMailboxSend(resolved);
}

/**
 * Resolve whose Firestore mailbox docs to read and what the viewer may do.
 * Pass `mailboxId` when available so per-mailbox assignees get send access for that box only.
 */
export async function resolveMailboxDataOwnerUid(input: {
  organizationId: string;
  viewerUid: string;
  viewerRole: OrgMemberRole;
  forUserParam: string | null | undefined;
  mailboxId?: string | null;
}): Promise<MailboxAccessResolved | { ok: false; status: number; error: string }> {
  const self = input.viewerUid;
  const requested = (input.forUserParam ?? "").trim();
  const dataOwnerUid = requested && requested !== self ? requested : self;
  const mailboxId = (input.mailboxId ?? "").trim();

  if (dataOwnerUid === self) {
    return {
      ok: true,
      dataOwnerUid: self,
      viewerIsMailboxOwner: true,
      permissions: allMailboxPermissions(),
    };
  }

  const member = await getMemberServer(input.organizationId, dataOwnerUid);
  if (!member || member.status !== "active") {
    return {
      ok: false,
      status: 404,
      error: "That workspace member was not found.",
    };
  }

  if (mailboxId) {
    const profile = await getMailboxProfileServer({
      organizationId: input.organizationId,
      uid: dataOwnerUid,
      mailboxId,
    });
    if (profile?.assignedUserIds.includes(input.viewerUid)) {
      return {
        ok: true,
        dataOwnerUid,
        viewerIsMailboxOwner: false,
        permissions: ["view", "send"],
      };
    }
  } else {
    const anyAssigned = await viewerHasAssignedMailboxOnHostServer({
      organizationId: input.organizationId,
      hostId: dataOwnerUid,
      viewerUid: input.viewerUid,
    });
    if (anyAssigned) {
      return {
        ok: true,
        dataOwnerUid,
        viewerIsMailboxOwner: false,
        permissions: ["view", "send"],
      };
    }
  }

  let hasHierarchyView = false;
  if (roleAtLeast(input.viewerRole, "admin")) {
    hasHierarchyView = true;
  } else {
    const orgUsers = await listOrgUsersServer(input.organizationId);
    if (viewerManagesUserServer(input.viewerUid, dataOwnerUid, orgUsers)) {
      hasHierarchyView = true;
    }
  }

  const hasDelegatedSend = await viewerHasMailboxDelegationServer({
    organizationId: input.organizationId,
    hostId: dataOwnerUid,
    viewerUid: input.viewerUid,
    permission: "send",
  });
  const hasDelegatedView = hasDelegatedSend
    ? true
    : await viewerHasMailboxDelegationServer({
        organizationId: input.organizationId,
        hostId: dataOwnerUid,
        viewerUid: input.viewerUid,
        permission: "view",
      });

  if (hasDelegatedSend) {
    return {
      ok: true,
      dataOwnerUid,
      viewerIsMailboxOwner: false,
      permissions: ["view", "send"],
    };
  }

  if (hasHierarchyView || hasDelegatedView) {
    return {
      ok: true,
      dataOwnerUid,
      viewerIsMailboxOwner: false,
      permissions: ["view"],
    };
  }

  return {
    ok: false,
    status: 403,
    error: "You can only open your own mailbox or one shared with you by a teammate.",
  };
}
