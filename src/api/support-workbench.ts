import type { Logger, LogLevel } from "@/observability/logger";
import type { SupportLogRecord, SupportLogRepository } from "@/domain/support-log";

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
  readonly supportLog: SupportLogRepository;
  readonly logger: Logger;
}

export async function handleGetSupportWorkbench(
  deps: SupportWorkbenchDeps,
  _request: SupportWorkbenchRequest,
): Promise<SupportWorkbenchResponse> {
  const diagnostics = (await deps.supportLog.listAll(50))
    .filter(isCloudShareWebhookDiagnostic)
    .map(toSupportWorkbenchDiagnostic)
    .slice(0, 20);

  return {
    status: 200,
    body: { diagnostics },
  };
}

function isCloudShareWebhookDiagnostic(record: SupportLogRecord): boolean {
  return (
    readStringField(record.fields, "operation") === "receive_webhook" &&
    readStringField(record.fields, "integrationSurface") === "cloudshare.v3.webhook"
  );
}

function toSupportWorkbenchDiagnostic(record: SupportLogRecord): SupportWorkbenchDiagnostic {
  return {
    timestamp: record.timestamp,
    level: record.level,
    message: record.message,
    operation: readStringField(record.fields, "operation"),
    integrationSurface: readStringField(record.fields, "integrationSurface"),
    customerId: readStringField(record.fields, "customerId"),
    webhookPathFingerprint: readStringField(record.fields, "webhookPathFingerprint"),
    method: readStringField(record.fields, "method"),
    path: readStringField(record.fields, "path"),
    requestBodyBytes: readNumberField(record.fields, "requestBodyBytes"),
    rawBodySha256: readStringField(record.fields, "rawBodySha256"),
    signaturePresent: readBooleanField(record.fields, "signaturePresent"),
    trustGateReason: readStringField(record.fields, "trustGateReason"),
  };
}

function readStringField(fields: Record<string, unknown>, key: string): string | null {
  const value = fields[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function readNumberField(fields: Record<string, unknown>, key: string): number | null {
  const value = fields[key];
  return typeof value === "number" ? value : null;
}

function readBooleanField(fields: Record<string, unknown>, key: string): boolean | null {
  const value = fields[key];
  return typeof value === "boolean" ? value : null;
}
