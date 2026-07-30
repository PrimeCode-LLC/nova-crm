"use client";

import { toast } from "sonner";
import { reportClientError } from "@/lib/error-logging/report-client";
import { messageFromUnknown } from "@/lib/error-logging/parse-stack";

export type ToastErrorMeta = {
  location?: string | null;
  functionName?: string | null;
  description?: string;
  httpStatus?: number | null;
  route?: string | null;
};

/**
 * Show an error toast and persist the failure for admin Error logs.
 */
export function toastError(
  userMessage: string,
  error?: unknown,
  meta?: ToastErrorMeta,
): void {
  const description =
    meta?.description ??
    (error != null ? messageFromUnknown(error, "") : undefined);
  if (description && description !== userMessage) {
    toast.error(userMessage, { description });
  } else {
    toast.error(userMessage);
  }

  reportClientError({
    message: userMessage,
    error,
    location: meta?.location,
    functionName: meta?.functionName,
    httpStatus: meta?.httpStatus,
    route: meta?.route,
    stack: error instanceof Error ? error.stack : undefined,
  });
}
