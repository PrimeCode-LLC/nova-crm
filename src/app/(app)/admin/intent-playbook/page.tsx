import { redirect } from "next/navigation";
import { AppPage } from "@/components/common/page-header";
import { IntentPlaybookAdminClient } from "@/app/(app)/admin/intent-playbook/intent-playbook-client";
import { requireSession } from "@/lib/auth/server";
import { isAuthDisabled } from "@/lib/auth/flags";
import { resolveLiveTenantForSession } from "@/lib/auth/resolve-live-tenant";
import { getOrganizationIntentPlaybookServer } from "@/lib/intent/intent-playbook-server";
import { defaultIntentPlaybook } from "@/lib/intent/playbook-templates";

export const dynamic = "force-dynamic";

export default async function IntentPlaybookAdminPage() {
  const session = await requireSession();

  const live = isAuthDisabled()
    ? { organizationId: session.organizationId, orgRole: session.orgRole, membershipPending: false }
    : await resolveLiveTenantForSession(session);
  const orgId = live.organizationId;
  if (!orgId && !isAuthDisabled()) redirect("/onboarding");

  const playbook = orgId
    ? await getOrganizationIntentPlaybookServer(orgId)
    : defaultIntentPlaybook();

  return (
    <AppPage>
      <IntentPlaybookAdminClient initialPlaybook={playbook} />
    </AppPage>
  );
}
