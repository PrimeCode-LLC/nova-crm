import { cookies } from "next/headers";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { AppTopbar } from "@/components/layout/app-topbar";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth/server";
import { isAuthDisabled } from "@/lib/auth/flags";
import { findMembershipForUserServer } from "@/lib/platform/members-server";
import { getOrganizationServer } from "@/lib/platform/organizations-server";
import { isUserPlatformAdmin } from "@/lib/platform/check-platform-admin";
import { WorkspaceModeProvider } from "@/components/providers/workspace-mode-provider";
import { ChannelAdminSync } from "@/components/providers/channel-admin-sync";
import { QuickAddLauncherProvider } from "@/components/layout/quick-add-launcher";
import { WORKSPACE_MODE_COOKIE, parseWorkspaceMode } from "@/lib/workspace-mode";
import { DEMO_PERSONA_COOKIE, parseDemoPersonaId } from "@/lib/demo-persona";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await requireSession();
  if (!isAuthDisabled()) {
    try {
      const m = await findMembershipForUserServer(session.uid);
      if (m?.status === "pending") {
        redirect("/join/pending");
      }
    } catch {
      /* allow app shell if membership lookup fails */
    }
  }
  const showPlatformLink =
    isAuthDisabled() ||
    (await isUserPlatformAdmin(session.uid, session.email));
  const jar = await cookies();
  const initialMode = parseWorkspaceMode(jar.get(WORKSPACE_MODE_COOKIE)?.value);
  const initialDemoPersonaId = parseDemoPersonaId(jar.get(DEMO_PERSONA_COOKIE)?.value);

  let organizationName: string | undefined;
  if (session.organizationId) {
    try {
      const org = await getOrganizationServer(session.organizationId);
      if (org?.name?.trim()) organizationName = org.name.trim();
    } catch {
      /* ignore */
    }
  }

  return (
    <WorkspaceModeProvider
      initialMode={initialMode}
      initialDemoPersonaId={initialDemoPersonaId}
      organizationName={organizationName}
    >
      <ChannelAdminSync />
      <QuickAddLauncherProvider>
        <SidebarProvider>
          <AppSidebar showPlatformLink={showPlatformLink} />
          <SidebarInset>
            <AppTopbar />
            <div className="flex flex-1 flex-col">{children}</div>
          </SidebarInset>
        </SidebarProvider>
      </QuickAddLauncherProvider>
    </WorkspaceModeProvider>
  );
}
