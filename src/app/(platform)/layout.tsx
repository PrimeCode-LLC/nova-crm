import { PlatformNav } from "@/components/platform/platform-nav";
import { requirePlatformAdminSession } from "@/lib/platform/require-platform-admin";

export default async function PlatformShellLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requirePlatformAdminSession();

  return (
    <div className="min-h-screen bg-background text-foreground">
      <PlatformNav />
      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">{children}</div>
    </div>
  );
}
