"use server";

import { cookies } from "next/headers";
import {
  WORKSPACE_MODE_COOKIE,
  WORKSPACE_MODE_MAX_AGE,
  type WorkspaceMode,
} from "@/lib/workspace-mode";

export async function setWorkspaceModeCookie(mode: WorkspaceMode) {
  const jar = await cookies();
  jar.set(WORKSPACE_MODE_COOKIE, mode, {
    path: "/",
    maxAge: WORKSPACE_MODE_MAX_AGE,
    sameSite: "lax",
    httpOnly: true,
  });
}
