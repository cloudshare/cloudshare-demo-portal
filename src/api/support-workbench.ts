import type { Logger, LogLevel } from "@/observability/logger";
import type { DiagnosticLogEntry, DiagnosticLogRepository } from "@/domain/diagnostic-log";

const CLOUDSHARE_WEBHOOK_SOURCE = "cloudshare-webhook";
const CLOUDSHARE_WEBHOOK_RECEIVE_OPERATION = "cloudshare.webhook.receive";
const CLOUDSHARE_WEBHOOK_INTEGRATION_SURFACE = "cloudshare.v3.webhook";

export interface SupportWorkbenchRequest {
  readonly query: Record<string, string | undefined>;
}

export interface SupportWorkbenchResponse {
  readonly status: number;
  readonly body: {
    diagnostics: SupportWorkbenchDiagnostic[];
  };
}

export interface SupportWorkbenchDiagnostic {
  readonly timestamp: Date;
  readonly level: LogLevel;
  readonly message: string;
  readonly operation: string | null;
  readonly integrationSurface: string | null;
  readonly customerId: string | null;
  readonly webhookPathFingerprint: string | null;
  readonly method: string | null;
  readonly path: string | null;
  readonly requestBodyBytes: number | null;
  readonly rawBodySha256: string | null;
  readonly signaturePresent: boolean | null;
  readonly trustGateReason: string | null;
}

export interface SupportWorkbenchDeps {
  readonly diagnostics: DiagnosticLogRepository;
  readonly logger: Logger;
}

export interface SupportWorkbenchServices {
  readonly diagnostics: DiagnosticLogRepository;
  readonly logger: Logger;
}

export function buildSupportWorkbenchDeps(
  services: SupportWorkbenchServices,
): SupportWorkbenchDeps {
  return {
    diagnostics: services.diagnostics,
    logger: services.logger,
  };
}

export async function handleGetSupportWorkbench(
  deps: SupportWorkbenchDeps,
  _request: SupportWorkbenchRequest,
): Promise<SupportWorkbenchResponse> {
  const diagnostics = (
    await deps.diagnostics.query({
      source: CLOUDSHARE_WEBHOOK_SOURCE,
      operation: CLOUDSHARE_WEBHOOK_RECEIVE_OPERATION,
      limit: 20,
    })
  ).map(toSupportWorkbenchDiagnostic);

  return {
    status: 200,
    body: { diagnostics },
  };
}

function toSupportWorkbenchDiagnostic(record: DiagnosticLogEntry): SupportWorkbenchDiagnostic {
  return {
    timestamp: record.occurredAt,
    level: record.level,
    message: record.message,
    operation: record.operation || null,
    integrationSurface:
      readStringField(record.details, "integrationSurface") ??
      (record.source === CLOUDSHARE_WEBHOOK_SOURCE ? CLOUDSHARE_WEBHOOK_INTEGRATION_SURFACE : null),
    customerId: record.customerId,
    webhookPathFingerprint: readStringField(record.externalIds, "webhookPathFingerprint"),
    method: readStringField(record.request, "method"),
    path: readStringField(record.request, "path"),
    requestBodyBytes: readNumberField(record.request, "requestBodyBytes"),
    rawBodySha256: readStringField(record.request, "rawBodySha256"),
    signaturePresent: readBooleanField(record.details, "signaturePresent"),
    trustGateReason:
      readStringField(record.details, "trustGateOutcome") ??
      readStringField(record.details, "trustGateReason") ??
      readStringField(record.details, "reason"),
  };
}

function readStringField(
  fields: Readonly<Record<string, unknown>> | null | undefined,
  key: string,
): string | null {
  const value = fields?.[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function readNumberField(
  fields: Readonly<Record<string, unknown>> | null | undefined,
  key: string,
): number | null {
  const value = fields?.[key];
  return typeof value === "number" ? value : null;
}

function readBooleanField(
  fields: Readonly<Record<string, unknown>> | null | undefined,
  key: string,
): boolean | null {
  const value = fields?.[key];
  return typeof value === "boolean" ? value : null;
}
