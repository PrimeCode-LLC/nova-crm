"use client";

import * as React from "react";
import { QuickAddDialog, type QuickAddPill } from "@/components/layout/quick-add-dialog";
import { NewProspectDialog } from "@/components/leads/new-prospect-dialog";
import type { ChannelKey, PipelineStage } from "@/lib/types";

export type NewProspectPrefill = {
  leadNotes?: string;
  channel?: ChannelKey;
  painPoints?: string;
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
      <QuickAddDialog
        open={open}
        onOpenChange={setOpen}
        initialPill={opts.initialPill ?? "lead"}
        initialLeadStage={opts.initialLeadStage}
      />
      <NewProspectDialog
        open={newProspectOpen}
        onOpenChange={(o) => {
          setNewProspectOpen(o);
          if (!o) setProspectPrefill(undefined);
        }}
        initialPrefill={prospectPrefill}
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
