import type { DiagnosticRecorder } from "@/domain/diagnostic-log";
import { createCloudShareWorkflowSequenceAllocator, type CloudShareWorkflowObservationContext } from "@/ports/cloudshare-observation";
import type { CloudShareRequestObservation } from "./client";
import type { V4TokenAcquisitionEvent } from "./v4-auth";
import { projectCloudShareFailureContext } from "./diagnostic-failure-projection";
import { randomUUID } from "node:crypto";

/** Customer-scoped default observer. OAuth evidence never records credentials. */
export function createCloudShareDiagnosticObserver(input: {
  readonly diagnostics: DiagnosticRecorder;
  readonly customerId: string;
  /** One correlation thread per factory-created Customer observer. */
  readonly correlationId?: string;
}) {
  let sequence = 0;
  const recordRequest = (event: CloudShareRequestObservation) => {
    const projectedFailure = projectCloudShareFailureContext(event.error?.context);
    const oauthFailure = projectedFailure?.request === null && projectedFailure.response === null;
    return input.diagnostics.record({
      occurredAt: new Date(event.occurredAt), source: "cloudshare-integration",
      operation: "cloudshare.request", outcome: event.outcome, customerId: input.customerId,
      actor: { type: "system", id: "cloudshare" }, subject: { type: "customer", id: input.customerId },
      ...(input.correlationId ? { correlationId: input.correlationId } : {}),
      message: event.outcome === "failure" ? "CloudShare request failed." : "CloudShare request completed.",
      request: event.result?.request as unknown as Record<string, unknown> ?? (projectedFailure ? projectedFailure.request : projectFailureRequest(event.error?.context)) ?? null,
      response: event.result?.response as unknown as Record<string, unknown> ?? (projectedFailure ? projectedFailure.response : projectFailureResponse(event.error?.context)) ?? null,
      details: {
        exchangeId: event.exchangeId,
        attemptStartSequence: event.attemptStartSequence,
        completedAt: event.completedAt,
        ...(input.correlationId ? { sequence: ++sequence } : {}),
        durationMs: event.durationMs,
        integrationSurface: event.result?.integrationSurface ?? event.error?.context?.integrationSurface ?? null,
        ...(event.error?.context?.failureMode ? { failureMode: event.error.context.failureMode } : {}),
        ...(event.error?.context?.causeClassification ? { causeClassification: event.error.context.causeClassification } : {}),
        error: oauthFailure ? projectErrorMetadata(event.error) : event.error ?? null,
      },
    });
  };
  const recordAcquisition = (event: V4TokenAcquisitionEvent) => input.diagnostics.record({
    occurredAt: new Date(event.occurredAt), source: "cloudshare-integration", operation: "cloudshare.oauth.token",
    outcome: event.outcome, customerId: input.customerId, actor: { type: "system", id: "cloudshare" },
    subject: { type: "customer", id: input.customerId }, message: event.outcome === "failure" ? "CloudShare OAuth exchange failed." : "CloudShare OAuth exchange completed.",
    ...(input.correlationId ? { correlationId: input.correlationId } : {}),
    request: null,
    response: null,
    details: {
      exchangeId: event.exchangeCorrelationId,
      evidenceKind: "transport",
      attemptStartSequence: event.attemptStartSequence,
      completedAt: event.completedAt,
      ...(input.correlationId ? { sequence: ++sequence } : {}),
      ...(event.exchangeCorrelationId ? { exchangeCorrelationId: event.exchangeCorrelationId } : {}),
      durationMs: event.durationMs,
      integrationSurface: event.integrationSurface,
      status: event.status ?? null,
      ...(event.failureMode ? { failureMode: event.failureMode } : {}),
      ...(event.causeClassification ? { causeClassification: event.causeClassification } : {}),
    },
  });
  return { onRequest: recordRequest, onAcquisition: recordAcquisition };
}

/**
 * A per-operation observer that gives all CloudShare wire activity one stable
 * diagnostic thread. The composition root combines this with its mandatory
 * Customer-scoped observer; this observer deliberately writes only the one
 * workflow row for each callback.
 */
export function createCloudShareWorkflowObserver(input: {
  readonly diagnostics: DiagnosticRecorder;
  readonly customerId: string;
} & CloudShareWorkflowObservationContext) {
  const sequenceAllocator = input.sequenceAllocator ?? createCloudShareWorkflowSequenceAllocator();
  const subject = () => typeof input.subject === "function" ? input.subject() : input.subject;
  const anchor = () => ({
    customerId: input.customerId,
    actor: input.actor,
    subject: subject(),
    correlationId: input.correlationId,
    ...(input.externalIds ? { externalIds: input.externalIds } : {}),
    ...(input.candidateEmail !== undefined ? { candidateEmail: input.candidateEmail } : {}),
    ...(input.examId !== undefined ? { examId: input.examId } : {}),
    ...(input.examAttemptId !== undefined ? { examAttemptId: input.examAttemptId } : {}),
  });
  return {
    onRequest: async (event: CloudShareRequestObservation) => {
      const projectedFailure = projectCloudShareFailureContext(event.error?.context);
      const oauthFailure = projectedFailure?.request === null && projectedFailure.response === null;
      const sequence = sequenceAllocator.next();
      await input.diagnostics.record({
        occurredAt: new Date(event.occurredAt), source: input.source,
        operation: "cloudshare.request", outcome: event.outcome,
        ...anchor(),
        message: event.outcome === "failure" ? "CloudShare request failed." : "CloudShare request completed.",
        request: event.result?.request as unknown as Record<string, unknown> ?? (projectedFailure ? projectedFailure.request : projectFailureRequest(event.error?.context)) ?? null,
        response: event.result?.response as unknown as Record<string, unknown> ?? (projectedFailure ? projectedFailure.response : projectFailureResponse(event.error?.context)) ?? null,
        details: {
          exchangeId: event.exchangeId,
          evidenceKind: "transport",
          attemptStartSequence: event.attemptStartSequence,
          completedAt: event.completedAt,
          sequence, durationMs: event.durationMs,
          integrationSurface: event.result?.integrationSurface ?? event.error?.context?.integrationSurface ?? null,
          ...(event.result ? { host: event.result.host } : {}),
          ...(event.error?.context?.failureMode ? { failureMode: event.error.context.failureMode } : {}),
          ...(event.error?.context?.causeClassification ? { causeClassification: event.error.context.causeClassification } : {}),
          ...(event.error ? { error: oauthFailure ? projectErrorMetadata(event.error) : event.error } : {}),
        },
      });
    },
    onAcquisition: async (event: V4TokenAcquisitionEvent) => {
      const sequence = sequenceAllocator.next();
      const exchangeCorrelationId = event.exchangeCorrelationId ?? randomUUID();
      await input.diagnostics.record({
        occurredAt: new Date(event.occurredAt), source: input.source,
        operation: "cloudshare.oauth.token", outcome: event.outcome,
        ...anchor(),
        message: event.outcome === "failure" ? "CloudShare OAuth exchange failed." : "CloudShare OAuth exchange completed.",
        request: null, response: null,
        details: {
          exchangeId: exchangeCorrelationId,
          attemptStartSequence: event.attemptStartSequence,
          completedAt: event.completedAt,
          sequence, durationMs: event.durationMs, integrationSurface: event.integrationSurface,
          parentCorrelationId: input.correlationId, exchangeCorrelationId,
          ...(event.status !== undefined ? { status: event.status } : {}),
          ...(event.failureMode ? { failureMode: event.failureMode } : {}),
          ...(event.causeClassification ? { causeClassification: event.causeClassification } : {}),
        },
      });
    },
  };
}

function projectErrorMetadata(error: CloudShareRequestObservation["error"]): Record<string, unknown> | null {
  if (!error) return null;
  const directStatus = (error as unknown as { status?: unknown }).status;
  const status = typeof directStatus === "number"
    ? directStatus
    : typeof error.context?.responseStatus === "number"
      ? error.context.responseStatus
      : typeof error.context?.status === "number"
        ? error.context.status
        : undefined;
  return {
    name: error.name,
    message: error.message,
    ...(status === undefined ? {} : { status }),
  };
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
