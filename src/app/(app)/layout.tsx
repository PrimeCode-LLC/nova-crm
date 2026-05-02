import { cookies } from "next/headers";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { AppTopbar } from "@/components/layout/app-topbar";
import { requireSession } from "@/lib/auth/server";
import { isAuthDisabled } from "@/lib/auth/flags";
import { isUserPlatformAdmin } from "@/lib/platform/check-platform-admin";
import { WorkspaceModeProvider } from "@/components/providers/workspace-mode-provider";
import { QuickAddLauncherProvider } from "@/components/layout/quick-add-launcher";
import { WORKSPACE_MODE_COOKIE, parseWorkspaceMode } from "@/lib/workspace-mode";
import { DEMO_PERSONA_COOKIE, parseDemoPersonaId } from "@/lib/demo-persona";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await requireSession();
  const showPlatformLink =
    isAuthDisabled() ||
    (await isUserPlatformAdmin(session.uid, session.email));
  const jar = await cookies();
  const initialMode = parseWorkspaceMode(jar.get(WORKSPACE_MODE_COOKIE)?.value);
  const initialDemoPersonaId = parseDemoPersonaId(jar.get(DEMO_PERSONA_COOKIE)?.value);

  return (
    <WorkspaceModeProvider initialMode={initialMode} initialDemoPersonaId={initialDemoPersonaId}>
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
