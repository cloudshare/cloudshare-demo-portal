import React from "react";

export interface SupportLogRecordRow {
  timestamp: string;
  level: "debug" | "info" | "warn" | "error";
  message: string;
  fields: Record<string, unknown>;
}

export interface SupportLogTableProps {
  readonly records: readonly SupportLogRecordRow[];
  readonly formatUtcTimestamp: (value: string | null | undefined) => string;
}

function readStringField(fields: Record<string, unknown>, key: string): string | null {
  const value = fields[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function readNumberField(fields: Record<string, unknown>, key: string): number | null {
  const value = fields[key];
  return typeof value === "number" ? value : null;
}

function formatSupportValue(value: unknown): string {
  if (value === undefined || value === null) {
    return "-";
  }
  if (typeof value === "string") {
    return value;
  }
  return JSON.stringify(value, null, 2);
}

const WEBHOOK_SUPPORT_FIELD_LABELS: Array<{ key: string; label: string }> = [
  { key: "webhookEvent", label: "Event" },
  { key: "webhookCreatedAt", label: "CreatedAt" },
  { key: "webhookCreatedById", label: "CreatedById" },
  { key: "webhookCreatedByEmail", label: "CreatedByEmail" },
  { key: "webhookAttempt", label: "Attempt" },
  { key: "webhookEnvironmentId", label: "EnvironmentId" },
  { key: "webhookEnvironmentExternalId", label: "EnvironmentExternalId" },
  { key: "webhookEnvironmentName", label: "EnvironmentName" },
  { key: "webhookBlueprintId", label: "BlueprintId" },
  { key: "webhookBlueprintName", label: "BlueprintName" },
  { key: "webhookPolicyId", label: "PolicyId" },
  { key: "webhookPolicyName", label: "PolicyName" },
  { key: "webhookOwnerEmail", label: "OwnerEmail" },
  { key: "webhookCloud", label: "Cloud" },
  { key: "webhookRegionId", label: "RegionId" },
];

function getWebhookSupportFieldRows(
  fields: Record<string, unknown>,
): Array<{ label: string; value: unknown }> {
  return WEBHOOK_SUPPORT_FIELD_LABELS
    .map(({ key, label }) => ({ label, value: fields[key] }))
    .filter(({ value }) => value !== undefined && value !== null && value !== "");
}

export function SupportLogTable({
  records,
  formatUtcTimestamp,
}: SupportLogTableProps) {
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ minWidth: "126rem", width: "100%", borderCollapse: "collapse", fontSize: "0.85rem", tableLayout: "fixed" }}>
        <colgroup>
          <col style={{ width: "17rem" }} />
          <col style={{ width: "5rem" }} />
          <col style={{ width: "14rem" }} />
          <col style={{ width: "12rem" }} />
          <col style={{ width: "18rem" }} />
          <col style={{ width: "8rem" }} />
          <col style={{ width: "12rem" }} />
          <col style={{ width: "40rem" }} />
        </colgroup>
        <thead>
          <tr style={{ background: "#f5f5f5" }}>
            {["Time (UTC)", "Level", "Operation", "Customer", "Request", "Result", "Correlation ID", "Details"].map((h) => (
              <th key={h} style={{ textAlign: "left", padding: "0.4rem", borderBottom: "1px solid #ddd" }}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {records.length === 0 && (
            <tr>
              <td colSpan={8} style={{ padding: "0.5rem", color: "#666" }}>
                No support log records
              </td>
            </tr>
          )}
          {records.map((record, index) => {
            const operation = readStringField(record.fields, "operation") ?? record.message;
            const customerId = readStringField(record.fields, "customerId");
            const method = readStringField(record.fields, "method");
            const path = readStringField(record.fields, "path");
            const responseStatus = readNumberField(record.fields, "responseStatus");
            const failureMode = readStringField(record.fields, "failureMode");
            const correlationId = readStringField(record.fields, "correlationId");
            const integrationSurface = readStringField(record.fields, "integrationSurface");
            const host = readStringField(record.fields, "host");
            const requestHeaders = record.fields.requestHeaders;
            const requestBody = record.fields.requestBody;
            const requestBodySummary = record.fields.requestBodySummary;
            const rawRequestBody = record.fields.rawRequestBody;
            const rawBodySha256 = readStringField(record.fields, "rawBodySha256");
            const receivedSignature = readStringField(record.fields, "receivedSignature");
            const expectedSignature = readStringField(record.fields, "expectedSignature");
            const signatureMatched = record.fields.signatureMatched;
            const signatureFailureHint = readStringField(record.fields, "signatureFailureHint");
            const storedWebhookSecretLength = readNumberField(record.fields, "storedWebhookSecretLength");
            const webhookFieldRows = getWebhookSupportFieldRows(record.fields);
            const responseHeaders = record.fields.responseHeaders;
            const responseBody = record.fields.responseBody;
            const network = record.fields.network;
            const tls = record.fields.tls;
            const cause = readStringField(record.fields, "cause");
            const errorMessage = readStringField(record.fields, "error");
            const verifiedAt = readStringField(record.fields, "verifiedAt");

            return (
              <tr key={`${record.timestamp}-${record.message}-${index}`} style={{ borderBottom: "1px solid #eee", verticalAlign: "top" }}>
                <td style={{ padding: "0.4rem", whiteSpace: "nowrap" }}>
                  {formatUtcTimestamp(record.timestamp)}
                </td>
                <td style={{ padding: "0.4rem", textTransform: "uppercase" }}>{record.level}</td>
                <td style={{ padding: "0.4rem", overflowWrap: "anywhere" }}>
                  <div>{operation}</div>
                  {integrationSurface && (
                    <div style={{ color: "#666", fontSize: "0.75rem" }}>{integrationSurface}</div>
                  )}
                </td>
                <td style={{ padding: "0.4rem", fontFamily: "monospace", overflowWrap: "anywhere" }}>
                  {customerId ?? "-"}
                </td>
                <td style={{ padding: "0.4rem", fontFamily: "monospace", overflowWrap: "anywhere", wordBreak: "break-word" }}>
                  {method ?? "?"} {host ? `${host}${path ?? ""}` : (path ?? "?")}
                </td>
                <td style={{ padding: "0.4rem", overflowWrap: "anywhere" }}>
                  {typeof responseStatus === "number" ? `HTTP ${responseStatus}` : failureMode ?? record.message}
                  {verifiedAt && (
                    <div style={{ color: "#666", fontSize: "0.75rem" }}>
                      Verified at {formatUtcTimestamp(verifiedAt)}
                    </div>
                  )}
                </td>
                <td style={{ padding: "0.4rem", fontFamily: "monospace", fontSize: "0.75rem", overflowWrap: "anywhere" }}>
                  {correlationId ?? "-"}
                </td>
                <td style={{ padding: "0.4rem", fontSize: "0.75rem", color: "#444", overflowWrap: "anywhere" }}>
                  <div style={{ display: "grid", gap: "0.35rem" }}>
                    <div>
                      <strong>Message:</strong> {record.message}
                    </div>
                    {errorMessage && (
                      <div>
                        <strong>Error:</strong> {errorMessage}
                      </div>
                    )}
                    {cause && (
                      <div>
                        <strong>Cause:</strong> {cause}
                      </div>
                    )}
                    {requestHeaders !== undefined && (
                      <div>
                        <strong>Request headers:</strong>
                        <pre style={{ margin: "0.2rem 0 0", whiteSpace: "pre-wrap" }}>
                          {formatSupportValue(requestHeaders)}
                        </pre>
                      </div>
                    )}
                    {requestBody !== undefined && (
                      <div>
                        <strong>Request body:</strong>
                        <pre style={{ margin: "0.2rem 0 0", whiteSpace: "pre-wrap" }}>
                          {formatSupportValue(requestBody)}
                        </pre>
                      </div>
                    )}
                    {webhookFieldRows.length > 0 && (
                      <div>
                        <strong>Webhook fields:</strong>
                        <dl style={{ display: "grid", gridTemplateColumns: "max-content minmax(12rem, 1fr)", columnGap: "0.75rem", rowGap: "0.2rem", margin: "0.2rem 0 0" }}>
                          {webhookFieldRows.map(({ label, value }) => (
                            <div key={label} style={{ display: "contents" }}>
                              <dt style={{ fontWeight: 600 }}>{label}</dt>
                              <dd style={{ margin: 0, fontFamily: "monospace", overflowWrap: "anywhere" }}>
                                {formatSupportValue(value)}
                              </dd>
                            </div>
                          ))}
                        </dl>
                      </div>
                    )}
                    {requestBodySummary !== undefined && (
                      <div>
                        <strong>Webhook request body summary:</strong>
                        <pre style={{ margin: "0.2rem 0 0", whiteSpace: "pre-wrap" }}>
                          {formatSupportValue(requestBodySummary)}
                        </pre>
                      </div>
                    )}
                    {rawRequestBody !== undefined && (
                      <div>
                        <strong>Raw webhook request body used for HMAC:</strong>
                        <pre style={{ margin: "0.2rem 0 0", whiteSpace: "pre-wrap" }}>
                          {formatSupportValue(rawRequestBody)}
                        </pre>
                      </div>
                    )}
                    {rawBodySha256 && (
                      <div>
                        <strong>Raw body SHA-256:</strong> <span style={{ fontFamily: "monospace" }}>{rawBodySha256}</span>
                      </div>
                    )}
                    {receivedSignature && (
                      <div>
                        <strong>Received x-cloudshare-signature:</strong> <span style={{ fontFamily: "monospace" }}>{receivedSignature}</span>
                      </div>
                    )}
                    {expectedSignature && (
                      <div>
                        <strong>Expected signature from stored secret:</strong> <span style={{ fontFamily: "monospace" }}>{expectedSignature}</span>
                      </div>
                    )}
                    {typeof storedWebhookSecretLength === "number" && (
                      <div>
                        <strong>Stored webhook secret length:</strong> {storedWebhookSecretLength} characters
                      </div>
                    )}
                    {typeof signatureMatched === "boolean" && (
                      <div>
                        <strong>Signature matched:</strong> {signatureMatched ? "yes" : "no"}
                      </div>
                    )}
                    {signatureFailureHint && (
                      <div style={{ color: "#8a5a00" }}>
                        <strong>Signature diagnostic:</strong> {signatureFailureHint}
                      </div>
                    )}
                    {responseBody !== undefined && (
                      <div>
                        <strong>Response body:</strong>
                        <pre style={{ margin: "0.2rem 0 0", whiteSpace: "pre-wrap" }}>
                          {formatSupportValue(responseBody)}
                        </pre>
                      </div>
                    )}
                    {responseHeaders !== undefined && (
                      <div>
                        <strong>Response headers:</strong>
                        <pre style={{ margin: "0.2rem 0 0", whiteSpace: "pre-wrap" }}>
                          {formatSupportValue(responseHeaders)}
                        </pre>
                      </div>
                    )}
                    {network !== undefined && (
                      <div>
                        <strong>Network:</strong>
                        <pre style={{ margin: "0.2rem 0 0", whiteSpace: "pre-wrap" }}>
                          {formatSupportValue(network)}
                        </pre>
                      </div>
                    )}
                    {tls !== undefined && (
                      <div>
                        <strong>TLS:</strong>
                        <pre style={{ margin: "0.2rem 0 0", whiteSpace: "pre-wrap" }}>
                          {formatSupportValue(tls)}
                        </pre>
                      </div>
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
