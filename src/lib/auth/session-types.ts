import type { OrgMemberRole } from "@/lib/types";

export type AppSession = {
  uid: string;
  email?: string;
  name?: string;
  organizationId?: string;
  orgRole?: OrgMemberRole;
  platformAdmin?: boolean;
};
