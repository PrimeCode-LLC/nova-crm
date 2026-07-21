import type {
  AssignedStrategyMatch,
  IntentPlaybook,
  QualityScoreResult,
  StrategyMatchAssignment,
  StrategyMatchPersona,
  StrategyMatchStrategy,
  TextBlock,
} from "@nova/scoring";

export type BootstrapPayload = {
  schemaVersion: number;
  configVersion: string;
  syncedAt: string;
  user: {
    id: string;
    email?: string;
    name?: string;
    organizationId: string;
    orgRole: string;
  };
  permissions: {
    canScan: boolean;
    canSaveIntake: boolean;
    canCreateProspect: boolean;
    canAttachProspect: boolean;
  };
  assignments: StrategyMatchAssignment[];
  strategies: StrategyMatchStrategy[];
  personas: StrategyMatchPersona[];
  playbook: IntentPlaybook;
  leaseExpiresAt: string;
  sessionExpiresAt: string;
};

export type ExtractedPage = {
  url: string;
  canonicalUrl: string;
  title: string;
  description: string;
  domain: string;
  text: string;
  selectedText: string;
  blocks: TextBlock[];
};

export type ScanResult = {
  scannedAt: string;
  page: ExtractedPage;
  quality: QualityScoreResult;
  strategies: AssignedStrategyMatch[];
};

export type ExtensionState = {
  status:
    | "locked"
    | "authenticating"
    | "ready"
    | "scanning"
    | "blocked"
    | "offline"
    | "error";
  tokenExpiresAt?: string;
  leaseExpiresAt?: string;
  bootstrap?: BootstrapPayload;
  result?: ScanResult;
  error?: string;
};

export type WorkingDraft = {
  id: string;
  completionPercent: number;
  missingRequiredFields: string[];
  sourceCount: number;
  strategy?: {
    strategyName: string;
    selectionMode: "auto" | "manual";
  };
  fields: Partial<
    Record<
      "companyName" | "contactName" | "contactEmail",
      { value: string; status: "proposed" | "accepted" | "verified" | "conflict" }
    >
  >;
};

export type WorkerRequest =
  | { type: "get-state" }
  | { type: "login" }
  | { type: "logout" }
  | { type: "refresh" }
  | { type: "scan"; mode?: "page" | "selection" }
  | {
      type: "save";
      action: "intake" | "draft" | "attach";
      leadId?: string;
      strategyAssignmentId?: string;
      strategySelectionMode?: "auto" | "manual";
    }
  | { type: "get-draft" }
  | {
      type: "update-draft";
      draftId: string;
      values: Partial<Record<"companyName" | "contactName" | "contactEmail", string>>;
    }
  | { type: "complete-draft"; draftId: string }
  | { type: "discard-draft"; draftId: string; reason: string }
  | { type: "clear-highlights" };
