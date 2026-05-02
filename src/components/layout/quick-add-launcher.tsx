"use client";

import * as React from "react";
import { QuickAddDialog, type QuickAddPill } from "@/components/layout/quick-add-dialog";
import type { PipelineStage } from "@/lib/types";

export type OpenQuickAddOpts = {
  initialPill?: QuickAddPill;
  initialLeadStage?: PipelineStage;
};

type QuickAddLauncherContextValue = {
  openQuickAdd: (opts?: OpenQuickAddOpts) => void;
};

const QuickAddLauncherContext = React.createContext<QuickAddLauncherContextValue | null>(
  null,
);

export function QuickAddLauncherProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = React.useState(false);
  const [opts, setOpts] = React.useState<OpenQuickAddOpts>({});

  const openQuickAdd = React.useCallback((next?: OpenQuickAddOpts) => {
    setOpts(next ?? {});
    setOpen(true);
  }, []);

  const value = React.useMemo(() => ({ openQuickAdd }), [openQuickAdd]);

  return (
    <QuickAddLauncherContext.Provider value={value}>
      {children}
      <QuickAddDialog
        open={open}
        onOpenChange={setOpen}
        initialPill={opts.initialPill ?? "lead"}
        initialLeadStage={opts.initialLeadStage}
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
