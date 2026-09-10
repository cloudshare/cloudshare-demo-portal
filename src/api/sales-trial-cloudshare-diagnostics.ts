import type {
  DiagnosticActor,
  DiagnosticRecorder,
  DiagnosticSubject,
} from "@/domain/diagnostic-log";
import type {
  CloudShareDetailedResult,
  CloudShareRequestObservation,
  V4TokenAcquisitionEvent,
} from "@/integrations/cloudshare";
import { projectCloudShareFailureContext } from "@/integrations/cloudshare/diagnostic-failure-projection";

type RequestFailure = NonNullable<CloudShareRequestObservation["error"]>;

function projectRequest(
  result: CloudShareDetailedResult<unknown> | undefined,
  failure: RequestFailure | undefined,
): Record<string, unknown> | null {
  if (result) {
    return result.request as unknown as Record<string, unknown>;
  }
  const context = failure?.context;
  const projectedFailure = projectCloudShareFailureContext(context);
  if (projectedFailure) return projectedFailure.request;
  if (!context) {
    return null;
  }
  const method = typeof context.method === "string" ? context.method : undefined;
  const path = typeof context.path === "string" ? context.path : undefined;
  const query =
    context.requestQuery &&
    typeof context.requestQuery === "object" &&
    !Array.isArray(context.requestQuery)
      ? (context.requestQuery as Record<string, unknown>)
      : undefined;
  const headers =
    context.requestHeaders &&
    typeof context.requestHeaders === "object" &&
    !Array.isArray(context.requestHeaders)
      ? (context.requestHeaders as Record<string, unknown>)
      : undefined;
  const body = context.requestBody;
  if (!method && !path && !query && !headers && body === undefined) {
    return null;
  }
  return {
    ...(method ? { method } : {}),
    ...(path ? { path } : {}),
    ...(query ? { query } : {}),
    ...(headers ? { headers } : {}),
    ...(body !== undefined ? { body } : {}),
  };
}

function projectResponse(
  result: CloudShareDetailedResult<unknown> | undefined,
  failure: RequestFailure | undefined,
): Record<string, unknown> | null {
  if (result) {
    return result.response as unknown as Record<string, unknown>;
  }
  const context = failure?.context;
  const projectedFailure = projectCloudShareFailureContext(context);
  if (projectedFailure) return projectedFailure.response;
  if (!context) {
    return null;
  }
  const status =
    typeof context.status === "number"
      ? context.status
      : typeof context.responseStatus === "number"
        ? context.responseStatus
        : undefined;
  const headers =
    context.responseHeaders &&
    typeof context.responseHeaders === "object" &&
    !Array.isArray(context.responseHeaders)
      ? (context.responseHeaders as Record<string, unknown>)
      : undefined;
  const body = context.responseBody;
  const network =
    context.network &&
    typeof context.network === "object" &&
    !Array.isArray(context.network)
      ? (context.network as Record<string, unknown>)
      : undefined;
  const tls =
    context.tls &&
    typeof context.tls === "object" &&
    !Array.isArray(context.tls)
      ? (context.tls as Record<string, unknown>)
      : undefined;
  const transport =
    typeof context.transport === "string" ? context.transport : undefined;
  const cause = context.cause;
  if (!status && !headers && body === undefined && !network && !tls && !transport && cause === undefined) {
    return null;
  }
  return {
    ...(status !== undefined ? { status } : {}),
    ...(headers ? { headers } : {}),
    ...(body !== undefined ? { body } : {}),
    ...(transport ? { transport } : {}),
    ...(cause !== undefined ? { cause } : {}),
    ...(network ? { network } : {}),
    ...(tls ? { tls } : {}),
  };
}

export function createSalesTrialCloudShareObserver(input: {
  readonly diagnostics: DiagnosticRecorder | undefined;
  readonly customerId: string;
  readonly actor: DiagnosticActor;
  readonly subject: DiagnosticSubject | (() => DiagnosticSubject);
  readonly correlationId: string;
  readonly source: "sales-trial-enrollment" | "sales-trial-offerings";
  readonly externalIds?: Record<string, string>;
  readonly candidateEmail?: string | null;
}): {
  readonly scope: "custom_observer";
  readonly correlationId: string;
  readonly onRequest: (event: CloudShareRequestObservation) => Promise<void>;
  readonly onAcquisition: (event: V4TokenAcquisitionEvent) => Promise<void>;
} {
  let sequence = 0;

  function resolveSubject(): DiagnosticSubject {
    return typeof input.subject === "function" ? input.subject() : input.subject;
  }

  return {
    scope: "custom_observer",
    correlationId: input.correlationId,
    onRequest: async (event) => {
      if (!input.diagnostics) {
        return;
      }
      const result = event.result;
      const failure = event.error;
      sequence += 1;
      await input.diagnostics.record({
        occurredAt: new Date(event.occurredAt),
        source: input.source,
        operation: "sales_trial.cloudshare.request",
        outcome: event.outcome,
        customerId: input.customerId,
        actor: input.actor,
        subject: resolveSubject(),
        correlationId: input.correlationId,
        candidateEmail: input.candidateEmail ?? null,
        externalIds: input.externalIds,
        message:
          event.outcome === "success"
            ? "CloudShare request completed."
            : "CloudShare request failed.",
        request: projectRequest(result, failure),
        response: projectResponse(result, failure),
        details: {
          evidenceKind: "transport",
          exchangeId: event.exchangeId,
          attemptStartSequence: event.attemptStartSequence,
          completedAt: event.completedAt,
          sequence,
          durationMs: event.durationMs,
          integrationSurface:
            result?.integrationSurface ??
            (typeof failure?.context?.integrationSurface === "string"
              ? failure.context.integrationSurface
              : null),
          ...(result ? { host: result.host } : {}),
          ...(failure
            ? {
                errorName: failure.name,
                errorMessage: failure.message,
              }
            : {}),
        },
      });
    },
    onAcquisition: async (event) => {
      if (!input.diagnostics) {
        return;
      }
      sequence += 1;
      await input.diagnostics.record({
        occurredAt: new Date(event.occurredAt),
        source: input.source,
        operation: "sales_trial.cloudshare.oauth_token",
        outcome: event.outcome,
        customerId: input.customerId,
        actor: input.actor,
        subject: resolveSubject(),
        correlationId: input.correlationId,
        candidateEmail: input.candidateEmail ?? null,
        externalIds: input.externalIds,
        message:
          event.outcome === "success"
            ? "CloudShare OAuth token acquired."
            : "CloudShare OAuth token acquisition failed.",
        details: {
          evidenceKind: "transport",
          exchangeId: event.exchangeCorrelationId,
          attemptStartSequence: sequence,
          completedAt: new Date().toISOString(),
          sequence,
          durationMs: event.durationMs,
          integrationSurface: event.integrationSurface,
          ...(event.status !== undefined ? { status: event.status } : {}),
          ...(event.failureMode ? { failureMode: event.failureMode } : {}),
          ...(event.causeClassification ? { causeClassification: event.causeClassification } : {}),
        },
      });
    },
  };
}
