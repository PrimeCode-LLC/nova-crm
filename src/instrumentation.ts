import type { Instrumentation } from "next";

/** Record unhandled server errors in the workspace error log (QA 2.8 / ROB-08). */
export const onRequestError: Instrumentation.onRequestError = async (err, request, context) => {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { reportRequestErrorServer } = await import("@/lib/error-logging/on-request-error-server");
  await reportRequestErrorServer(
    err,
    { path: request.path, method: request.method, headers: request.headers },
    { routePath: context.routePath, routeType: context.routeType },
  );
};
