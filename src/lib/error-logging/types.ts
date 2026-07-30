export type ErrorLogSource = "client" | "server";

export type ErrorLogRecord = {
  id: string;
  organizationId: string;
  createdAt: string | null;
  location: string;
  functionName: string;
  message: string;
  stack: string | null;
  source: ErrorLogSource;
  actorUid: string | null;
  actorEmail: string | null;
  url: string | null;
  route: string | null;
  httpStatus: number | null;
};

export type ReportErrorInput = {
  organizationId: string;
  message: string;
  source: ErrorLogSource;
  error?: unknown;
  location?: string | null;
  functionName?: string | null;
  stack?: string | null;
  actorUid?: string | null;
  actorEmail?: string | null;
  url?: string | null;
  route?: string | null;
  httpStatus?: number | null;
};

export type ClientReportErrorInput = {
  message: string;
  error?: unknown;
  location?: string | null;
  functionName?: string | null;
  stack?: string | null;
  url?: string | null;
  route?: string | null;
  httpStatus?: number | null;
};

export const ERROR_LOG_MESSAGE_MAX = 2_000;
export const ERROR_LOG_STACK_MAX = 12_000;
export const ERROR_LOG_LOCATION_MAX = 500;
export const ERROR_LOG_FUNCTION_MAX = 200;
export const ERROR_LOG_URL_MAX = 1_000;
