import { NextResponse } from "next/server";
import { isBackupOnlyModeEnabled } from "@/lib/platform/platform-settings-server";

/**
 * Shared early-exit for App Hosting cron routes when Backup only mode is on.
 * Returns a 200 so Cloud Scheduler / Functions treat the tick as successful.
 */
export async function backupOnlyCronSkipResponse(
  cronName: string,
): Promise<NextResponse | null> {
  if (!(await isBackupOnlyModeEnabled())) return null;
  return NextResponse.json({
    ok: true,
    skipped: true,
    reason: "backup_only_mode",
    cron: cronName,
  });
}
