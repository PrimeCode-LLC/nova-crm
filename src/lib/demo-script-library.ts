import type { ScriptCategory, ScriptLibraryItem } from "./types";
import { DEMO_WORKSPACE_ORG_ID } from "./demo-workspace-ids";
import { getUserById, mockScriptLibrary } from "./mock-data";

/**
 * Demo mode shows the **entire** sample library for every persona (tours / training).
 * Live workspace still uses `/api/org/scripts` (owner vs admin visibility).
 */
export function demoScriptsCanViewAll(_viewerId: string): boolean {
  return true;
}

export function listDemoScriptsForViewer(_viewerId: string): ScriptLibraryItem[] {
  const all = [...mockScriptLibrary];
  all.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return all;
}

export function buildNewDemoScript(input: {
  viewerId: string;
  title: string;
  category: ScriptCategory;
  primaryText: string;
  secondaryText: string;
  tags: string[];
}): ScriptLibraryItem {
  const id = `demo-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6)}`;
  const now = new Date().toISOString();
  const u = getUserById(input.viewerId);
  const primaryText = input.primaryText.trim();
  const secondaryText = input.secondaryText.trim();
  return {
    id,
    organizationId: DEMO_WORKSPACE_ORG_ID,
    ownerUid: input.viewerId,
    ownerName: u?.displayName,
    title: input.title.trim(),
    category: input.category,
    primaryText,
    secondaryText,
    content: [primaryText, secondaryText].filter(Boolean).join("\n\n"),
    tags: input.tags,
    createdAt: now,
    updatedAt: now,
  };
}
