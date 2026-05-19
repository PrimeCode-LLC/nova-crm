import { getMemberServer } from "@/lib/platform/members-server";
import { roleAtLeast } from "@/lib/platform/org-role";
import type { OrgMemberRole } from "@/lib/types";

export async function resolveMailboxDataOwnerUid(input: {
  organizationId: string;
  viewerUid: string;
  viewerRole: OrgMemberRole;
  forUserParam: string | null | undefined;
}): Promise<
  | { ok: true; dataOwnerUid: string; viewerIsMailboxOwner: boolean }
  | { ok: false; status: number; error: string }
> {
  const self = input.viewerUid;
  const requested = (input.forUserParam ?? "").trim();
  const dataOwnerUid = requested && requested !== self ? requested : self;

  if (dataOwnerUid === self) {
    return { ok: true, dataOwnerUid: self, viewerIsMailboxOwner: true };
  }

  if (!roleAtLeast(input.viewerRole, "admin")) {
    return {
      ok: false,
      status: 403,
      error: "Only workspace admins can open another member’s mailbox.",
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

  return { ok: true, dataOwnerUid, viewerIsMailboxOwner: false };
}
