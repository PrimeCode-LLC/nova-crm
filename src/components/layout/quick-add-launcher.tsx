"use client";

import * as React from "react";
import dynamic from "next/dynamic";
import type { QuickAddPill } from "@/components/layout/quick-add-dialog";
import type { ChannelKey, PipelineStage } from "@/lib/types";
import { useWorkspace } from "@/components/providers/workspace-mode-provider";

export type NewProspectPrefill = {
  leadNotes?: string;
  channel?: ChannelKey;
  painPoints?: string;
  /** Prospecting strategy attribution (Phase 1). */
  strategyId?: string;
  strategyAssignmentId?: string;
  strategyVersion?: number;
  personaId?: string;
};

export type NewProspectLaunch = {
  source:
    | "global_command"
    | "prospects_page"
    | "leads_table"
    | "my_strategy"
    | "fit_check"
    | "draft_banner"
    | "draft_center";
  destination?: string;
  sourceReference?: string;
  draftId?: string;
  prefill?: NewProspectPrefill;
};

export type OpenQuickAddOpts = {
  initialPill?: QuickAddPill;
  initialLeadStage?: PipelineStage;
};

type QuickAddLauncherContextValue = {
  openQuickAdd: (opts?: OpenQuickAddOpts) => void;
  openNewProspectForm: (launch: NewProspectLaunch) => void;
};

const QuickAddLauncherContext = React.createContext<QuickAddLauncherContextValue | null>(
  null,
);

const QuickAddDialog = dynamic(
  () => import("@/components/layout/quick-add-dialog").then((m) => ({ default: m.QuickAddDialog })),
  { ssr: false },
);

const NewProspectDialog = dynamic(
  () => import("@/components/leads/new-prospect-dialog").then((m) => ({ default: m.NewProspectDialog })),
  { ssr: false },
);

export function QuickAddLauncherProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = React.useState(false);
  const [opts, setOpts] = React.useState<OpenQuickAddOpts>({});
  const [newProspectOpen, setNewProspectOpen] = React.useState(false);
  const [prospectLaunch, setProspectLaunch] = React.useState<NewProspectLaunch | undefined>();
  const [prospectLaunchKey, setProspectLaunchKey] = React.useState(0);
  const workspace = useWorkspace();
  const requestWorkspaceGroups = workspace.requestWorkspaceGroups;

  const openQuickAdd = React.useCallback(
    (next?: OpenQuickAddOpts) => {
      requestWorkspaceGroups?.(["directory"]);
      setOpts(next ?? {});
      setOpen(true);
    },
    [requestWorkspaceGroups],
  );

  const openNewProspectForm = React.useCallback(
    (launch: NewProspectLaunch) => {
      requestWorkspaceGroups?.(["directory", "campaigns"]);
      setProspectLaunch(launch);
      setProspectLaunchKey((value) => value + 1);
      setNewProspectOpen(true);
    },
    [requestWorkspaceGroups],
  );

  const handleNewProspectOpenChange = React.useCallback((nextOpen: boolean) => {
    setNewProspectOpen(nextOpen);
    if (!nextOpen) setProspectLaunch(undefined);
  }, []);

  const value = React.useMemo(
    () => ({ openQuickAdd, openNewProspectForm }),
    [openQuickAdd, openNewProspectForm],
  );

  return (
    <QuickAddLauncherContext.Provider value={value}>
      {children}
      {open ? (
        <QuickAddDialog
          open={open}
          onOpenChange={setOpen}
          initialPill={opts.initialPill ?? "lead"}
          initialLeadStage={opts.initialLeadStage}
        />
      ) : null}
      <NewProspectDialog
        key={prospectLaunchKey}
        open={newProspectOpen}
        onOpenChange={handleNewProspectOpenChange}
        launch={prospectLaunch}
      />
    </QuickAddLauncherContext.Provider>
  );
}

export function useOpenQuickAdd() {
  const ctx = React.useContext(QuickAddLauncherContext);
  if (!ctx) {
    throw new Error("useOpenQuickAdd must be used within QuickAddLauncherProvider");
  }
  return ctx;
}
