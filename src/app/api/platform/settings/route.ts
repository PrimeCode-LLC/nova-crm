import { NextResponse } from "next/server";
import { z } from "zod";
import { guardPlatformApi } from "@/lib/platform/platform-api-guard";
import {
  getPlatformOpsSettingsServer,
  setBackupOnlyModeServer,
} from "@/lib/platform/platform-settings-server";

const patchSchema = z.object({
  backupOnlyMode: z.boolean(),
  backupOnlyReason: z.string().max(500).optional(),
});

export async function GET() {
  const g = await guardPlatformApi();
  if (!g.ok) return g.response;
  const settings = await getPlatformOpsSettingsServer();
  const envForced =
    process.env.PLATFORM_BACKUP_ONLY?.trim().toLowerCase() === "1" ||
    process.env.PLATFORM_BACKUP_ONLY?.trim().toLowerCase() === "true" ||
    process.env.PLATFORM_BACKUP_ONLY?.trim().toLowerCase() === "yes";
  return NextResponse.json({ settings, envForced });
}

export async function PATCH(req: Request) {
  const g = await guardPlatformApi();
  if (!g.ok) return g.response;

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = patchSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  try {
    const settings = await setBackupOnlyModeServer({
      enabled: parsed.data.backupOnlyMode,
      reason: parsed.data.backupOnlyReason,
      actorUid: g.ctx.session.uid,
    });
    return NextResponse.json({ ok: true, settings });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to update settings";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
