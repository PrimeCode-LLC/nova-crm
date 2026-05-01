"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { WORKSPACE_MODE_COOKIE, WORKSPACE_MODE_MAX_AGE } from "@/lib/workspace-mode";
import {
  DEMO_PERSONA_COOKIE,
  DEMO_PERSONA_MAX_AGE,
  parseDemoPersonaId,
} from "@/lib/demo-persona";

const cookieBase = {
  path: "/",
  sameSite: "lax" as const,
  httpOnly: true,
};

export async function setDemoPersonaCookie(personaId: string) {
  const id = parseDemoPersonaId(personaId);
  (await cookies()).set(DEMO_PERSONA_COOKIE, id, {
    ...cookieBase,
    maxAge: DEMO_PERSONA_MAX_AGE,
  });
}

/** Enables demo workspace + sample user (for login quick-entry or reset). */
export async function setDemoExplorationCookies(personaId: string) {
  const jar = await cookies();
  const id = parseDemoPersonaId(personaId);
  jar.set(WORKSPACE_MODE_COOKIE, "demo", {
    ...cookieBase,
    maxAge: WORKSPACE_MODE_MAX_AGE,
  });
  jar.set(DEMO_PERSONA_COOKIE, id, {
    ...cookieBase,
    maxAge: DEMO_PERSONA_MAX_AGE,
  });
}

export async function startDemoExploration(personaId: string) {
  await setDemoExplorationCookies(personaId);
  redirect("/dashboard");
}
