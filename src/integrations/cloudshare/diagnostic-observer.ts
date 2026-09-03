import type { DiagnosticRecorder } from "@/domain/diagnostic-log";
import type { CloudShareRequestObservation } from "./client";
import type { V4TokenAcquisitionEvent } from "./v4-auth";
import { projectCloudShareFailureContext } from "./diagnostic-failure-projection";

/** Customer-scoped default observer. OAuth evidence never records credentials. */
export function createCloudShareDiagnosticObserver(input: {
  readonly diagnostics: DiagnosticRecorder;
  readonly customerId: string;
}) {
  const recordRequest = (event: CloudShareRequestObservation) => input.diagnostics.record({
    occurredAt: new Date(event.occurredAt), source: "cloudshare-integration",
    operation: "cloudshare.request", outcome: event.outcome, customerId: input.customerId,
    actor: { type: "system", id: "cloudshare" }, subject: { type: "customer", id: input.customerId },
    message: event.outcome === "failure" ? "CloudShare request failed." : "CloudShare request completed.",
    request: event.result?.request as unknown as Record<string, unknown> ?? projectCloudShareFailureContext(event.error?.context)?.request ?? projectFailureRequest(event.error?.context) ?? null,
    response: event.result?.response as unknown as Record<string, unknown> ?? projectCloudShareFailureContext(event.error?.context)?.response ?? projectFailureResponse(event.error?.context) ?? null,
    details: {
      durationMs: event.durationMs,
      integrationSurface: event.result?.integrationSurface ?? event.error?.context?.integrationSurface ?? null,
      ...(event.error?.context?.failureMode ? { failureMode: event.error.context.failureMode } : {}),
      ...(event.error?.context?.causeClassification ? { causeClassification: event.error.context.causeClassification } : {}),
      error: event.error ?? null,
    },
  });
  const recordAcquisition = (event: V4TokenAcquisitionEvent) => input.diagnostics.record({
    occurredAt: new Date(event.occurredAt), source: "cloudshare-integration", operation: "cloudshare.oauth.token",
    outcome: event.outcome, customerId: input.customerId, actor: { type: "system", id: "cloudshare" },
    subject: { type: "customer", id: input.customerId }, message: event.outcome === "failure" ? "CloudShare OAuth exchange failed." : "CloudShare OAuth exchange completed.",
    request: null,
    response: null,
    details: {
      durationMs: event.durationMs,
      integrationSurface: event.integrationSurface,
      status: event.status ?? null,
      ...(event.failureMode ? { failureMode: event.failureMode } : {}),
      ...(event.causeClassification ? { causeClassification: event.causeClassification } : {}),
    },
  });
  return { onRequest: recordRequest, onAcquisition: recordAcquisition };
}

function projectFailureRequest(context?: Record<string, unknown>): Record<string, unknown> | null {
  if (!context) return null;
  const request: Record<string, unknown> = {};
  for (const key of ["method", "path", "requestQuery", "requestHeaders", "requestBody"]) {
    if (key in context) request[key] = context[key];
  }
  return Object.keys(request).length ? request : null;
}

function projectFailureResponse(context?: Record<string, unknown>): Record<string, unknown> | null {
  if (!context) return null;
  const response: Record<string, unknown> = {};
  for (const key of ["responseStatus", "responseHeaders", "responseBody", "transport", "cause", "network", "tls"]) {
    if (key in context) response[key] = context[key];
  }
  if (!("status" in response)) {
    if (typeof context.responseStatus === "number") response.status = context.responseStatus;
    else if (typeof context.status === "number") response.status = context.status;
  }
  delete response.responseStatus;
  return Object.keys(response).length ? response : null;
}
