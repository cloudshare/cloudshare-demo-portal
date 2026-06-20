import type { SupportLogRecord } from "@/domain/support-log";

const UNTRUSTED_WEBHOOK_MESSAGES = new Set([
  "cloudshare webhook rejected: unknown webhook target",
  "cloudshare webhook rejected: missing signature",
  "cloudshare webhook rejected: invalid signature",
]);

export function sanitizeSupportLogRecords(
  records: readonly SupportLogRecord[],
): SupportLogRecord[] {
  const trustedWebhookBodyKeys = collectTrustedWebhookBodyKeys(records);
  return records.map((record) => sanitizeSupportLogRecord(record, trustedWebhookBodyKeys));
}

export function sanitizeSupportLogRecord(
  record: SupportLogRecord,
  trustedWebhookBodyKeys: ReadonlySet<string>,
): SupportLogRecord {
  if (!isCloudShareWebhookDiagnostic(record)) {
    return record;
  }

  const rawRequestBody = getSafeRawWebhookBody(record, trustedWebhookBodyKeys);
  if (rawRequestBody === readStringField(record.fields, "rawRequestBody")) {
    return record;
  }

  return {
    ...record,
    fields: {
      ...record.fields,
      rawRequestBody,
    },
  };
}

export function isCloudShareWebhookDiagnostic(record: SupportLogRecord): boolean {
  return (
    readStringField(record.fields, "operation") === "receive_webhook" &&
    readStringField(record.fields, "integrationSurface") === "cloudshare.v3.webhook"
  );
}

export function isVisibleToSupportWorkbenchCustomer(
  record: SupportLogRecord,
  customerId: string,
): boolean {
  const recordCustomerId = readStringField(record.fields, "customerId");
  return recordCustomerId === null || recordCustomerId === customerId;
}

export function collectTrustedWebhookBodyKeys(
  records: readonly SupportLogRecord[],
): Set<string> {
  const trustedKeys = new Set<string>();
  for (const record of records) {
    if (record.message !== "cloudshare webhook signature diagnostic") {
      continue;
    }
    if (record.fields.signatureMatched !== true) {
      continue;
    }

    const key = getWebhookBodyTrustKey(record.fields);
    if (key) {
      trustedKeys.add(key);
    }
  }
  return trustedKeys;
}

function getSafeRawWebhookBody(
  record: SupportLogRecord,
  trustedWebhookBodyKeys: ReadonlySet<string>,
): string | null {
  const rawRequestBody = readStringField(record.fields, "rawRequestBody");
  if (!rawRequestBody) {
    return null;
  }

  if (UNTRUSTED_WEBHOOK_MESSAGES.has(record.message)) {
    return null;
  }

  const trustKey = getWebhookBodyTrustKey(record.fields);
  if (!trustKey || !trustedWebhookBodyKeys.has(trustKey)) {
    return null;
  }

  return rawRequestBody;
}

function getWebhookBodyTrustKey(fields: Record<string, unknown>): string | null {
  const customerId = readStringField(fields, "customerId");
  const webhookPathToken = readStringField(fields, "webhookPathToken");
  const rawBodySha256 = readStringField(fields, "rawBodySha256");
  if (!customerId || !webhookPathToken || !rawBodySha256) {
    return null;
  }
  return `${customerId}:${webhookPathToken}:${rawBodySha256}`;
}

function readStringField(fields: Record<string, unknown>, key: string): string | null {
  const value = fields[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}
