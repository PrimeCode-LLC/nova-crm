"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import type { WorkspaceMode } from "@/lib/workspace-mode";
import {
  getWorkspaceSnapshot,
  createWorkspaceLookup,
  type WorkspaceSnapshot,
  type WorkspaceLookup,
} from "@/lib/workspace-dataset";
import { setWorkspaceModeCookie } from "@/app/(app)/actions/workspace-mode";
import { setDemoPersonaCookie } from "@/app/(app)/actions/demo-persona";

export type WorkspaceContextValue = WorkspaceSnapshot &
  WorkspaceLookup & {
    mode: WorkspaceMode;
    isDemo: boolean;
    demoPersonaId: string;
    setMode: (next: WorkspaceMode) => Promise<void>;
    setDemoPersona: (userId: string) => Promise<void>;
  };

const WorkspaceContext = React.createContext<WorkspaceContextValue | null>(null);

export function WorkspaceModeProvider({
  initialMode,
  initialDemoPersonaId,
  children,
}: {
  initialMode: WorkspaceMode;
  initialDemoPersonaId: string;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [mode, setModeState] = React.useState<WorkspaceMode>(initialMode);
  const [demoPersonaId, setDemoPersonaState] = React.useState(initialDemoPersonaId);

  React.useEffect(() => {
    setModeState(initialMode);
  }, [initialMode]);

  React.useEffect(() => {
    setDemoPersonaState(initialDemoPersonaId);
  }, [initialDemoPersonaId]);

  const setMode = React.useCallback(
    async (next: WorkspaceMode) => {
      setModeState(next);
      await setWorkspaceModeCookie(next);
      router.refresh();
    },
    [router],
  );

  const setDemoPersona = React.useCallback(
    async (userId: string) => {
      setDemoPersonaState(userId);
      await setDemoPersonaCookie(userId);
      router.refresh();
    },
    [router],
  );

  const value = React.useMemo<WorkspaceContextValue>(() => {
    const snapshot = getWorkspaceSnapshot(mode, demoPersonaId);
    const lookup = createWorkspaceLookup(snapshot);
    return {
      ...snapshot,
      ...lookup,
      mode,
      isDemo: mode === "demo",
      demoPersonaId,
      setMode,
      setDemoPersona,
    };
  }, [mode, demoPersonaId, setMode, setDemoPersona]);

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace(): WorkspaceContextValue {
  const ctx = React.useContext(WorkspaceContext);
  if (!ctx) {
    throw new Error("useWorkspace must be used within WorkspaceModeProvider");
  }
  return ctx;
}
