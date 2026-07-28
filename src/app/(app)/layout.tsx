import { cookies } from "next/headers";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { AppTopbar } from "@/components/layout/app-topbar";
import { WorkspaceStatusBanner } from "@/components/layout/workspace-status-banner";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth/server";
import { isAuthDisabled } from "@/lib/auth/flags";
import { findMembershipForUserServer } from "@/lib/platform/members-server";
import { getOrganizationServer } from "@/lib/platform/organizations-server";
import { isUserPlatformAdmin } from "@/lib/platform/check-platform-admin";
import { WorkspaceModeProvider } from "@/components/providers/workspace-mode-provider";
import { TeamChatUnreadProvider } from "@/components/providers/team-chat-unread-provider";
import { DeferredAppSync } from "@/components/providers/deferred-app-sync";
import { QuickAddLauncherProvider } from "@/components/layout/quick-add-launcher";
import { ModuleRouteGate } from "@/components/permissions/module-route-gate";
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
  let organizationTimezone: string | undefined;
  if (session.organizationId) {
    try {
      const org = await getOrganizationServer(session.organizationId);
      if (org?.name?.trim()) organizationName = org.name.trim();
      const tz = org?.settings.timezone?.trim();
      if (tz) organizationTimezone = tz;
    } catch {
      /* ignore */
    }
  }

  return (
    <WorkspaceModeProvider
      initialMode={initialMode}
      initialDemoPersonaId={initialDemoPersonaId}
      organizationName={organizationName}
      organizationTimezone={organizationTimezone}
    >
      <TeamChatUnreadProvider deferSubscriptions>
        <DeferredAppSync />
        <QuickAddLauncherProvider>
          <SidebarProvider>
            <AppSidebar showPlatformLink={showPlatformLink} />
            <SidebarInset>
              <AppTopbar />
              <WorkspaceStatusBanner />
              <div className="flex h-0 min-h-0 flex-1 flex-col overflow-hidden">
                <ModuleRouteGate>{children}</ModuleRouteGate>
              </div>
            </SidebarInset>
          </SidebarProvider>
        </QuickAddLauncherProvider>
      </TeamChatUnreadProvider>
    </WorkspaceModeProvider>
  );
}
