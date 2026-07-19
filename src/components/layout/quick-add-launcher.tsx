"use client";

import * as React from "react";
import dynamic from "next/dynamic";
import type { QuickAddPill } from "@/components/layout/quick-add-dialog";
import type { ChannelKey, PipelineStage } from "@/lib/types";

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

export type OpenQuickAddOpts = {
  initialPill?: QuickAddPill;
  initialLeadStage?: PipelineStage;
};

type QuickAddLauncherContextValue = {
  openQuickAdd: (opts?: OpenQuickAddOpts) => void;
  openNewProspectForm: (prefill?: NewProspectPrefill) => void;
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
  const [prospectPrefill, setProspectPrefill] = React.useState<NewProspectPrefill | undefined>();

  const openQuickAdd = React.useCallback((next?: OpenQuickAddOpts) => {
    setOpts(next ?? {});
    setOpen(true);
  }, []);

  const openNewProspectForm = React.useCallback((prefill?: NewProspectPrefill) => {
    setProspectPrefill(prefill);
    setNewProspectOpen(true);
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
      {newProspectOpen ? (
        <NewProspectDialog
          open={newProspectOpen}
          onOpenChange={(o) => {
            setNewProspectOpen(o);
            if (!o) setProspectPrefill(undefined);
          }}
          initialPrefill={prospectPrefill}
        />
      ) : null}
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
