import type { DiagnosticRecorder } from "@/domain/diagnostic-log";
import type { CloudShareRequestObservation } from "./client";
import type { V4TokenAcquisitionEvent } from "./v4-auth";

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
    request: event.result?.request as unknown as Record<string, unknown> ?? event.error?.context?.request as Record<string, unknown> ?? null,
    response: event.result?.response as unknown as Record<string, unknown> ?? event.error?.context?.response as Record<string, unknown> ?? null,
    details: { durationMs: event.durationMs, integrationSurface: event.result?.integrationSurface ?? event.error?.context?.integrationSurface ?? null, error: event.error ?? null },
  });
  const recordAcquisition = (event: V4TokenAcquisitionEvent) => input.diagnostics.record({
    occurredAt: new Date(event.occurredAt), source: "cloudshare-integration", operation: "cloudshare.oauth.token",
    outcome: event.outcome, customerId: input.customerId, actor: { type: "system", id: "cloudshare" },
    subject: { type: "customer", id: input.customerId }, message: event.outcome === "failure" ? "CloudShare OAuth exchange failed." : "CloudShare OAuth exchange completed.",
    request: event.outcome === "failure" ? event.request ?? null : null,
    response: event.outcome === "failure" ? event.response ?? null : null,
    details: { durationMs: event.durationMs, integrationSurface: event.integrationSurface, status: event.status ?? null },
  });
  return { onRequest: recordRequest, onAcquisition: recordAcquisition };
}
