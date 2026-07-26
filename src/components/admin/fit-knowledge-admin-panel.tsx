"use client";

import { KnowledgeAdminPanel } from "@/components/admin/knowledge-admin-panel";

/**
 * @deprecated Prefer KnowledgeAdminPanel with mode="libraries" | "overview".
 */
export function FitKnowledgeAdminPanel({
  aiEnabled,
  onSeeded,
}: {
  aiEnabled: boolean;
  onSeeded?: () => void;
}) {
  return (
    <KnowledgeAdminPanel mode="libraries" aiEnabled={aiEnabled} onSeeded={onSeeded} />
  );
}
