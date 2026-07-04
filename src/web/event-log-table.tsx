import React from "react";
import { cardStyle } from "./card-styles";
import { colors } from "./design-tokens";

export interface EventLogRecordRow {
  eventId: string;
  type: string;
  occurredAt: string;
  payload: Record<string, unknown>;
}

export interface EventLogTableProps {
  readonly records: readonly EventLogRecordRow[];
  readonly formatUtcTimestamp: (value: string | null | undefined) => string;
  readonly buildRowKey: (record: EventLogRecordRow, index: number) => string;
}

function readCustomerId(payload: Record<string, unknown>): string | null {
  const value = payload.customerId;
  return typeof value === "string" && value.length > 0 ? value : null;
}

export function EventLogTable({
  records,
  formatUtcTimestamp,
  buildRowKey,
}: EventLogTableProps) {
  return (
    <div style={{ ...cardStyle, padding: 0, overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem" }}>
        <thead>
          <tr style={{ background: colors.surfaceSubtle }}>
            {["Time", "Type", "Customer", "Event ID", "Payload"].map((h) => (
              <th key={h} style={{ textAlign: "left", padding: "0.4rem", borderBottom: `1px solid ${colors.border}` }}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {records.length === 0 && (
            <tr>
              <td colSpan={5} style={{ padding: "0.5rem", color: colors.textSecondary }}>
                No events recorded
              </td>
            </tr>
          )}
          {records.map((record, index) => (
            <tr key={buildRowKey(record, index)} style={{ borderBottom: `1px solid ${colors.border}` }}>
              <td style={{ padding: "0.4rem", whiteSpace: "nowrap" }}>
                {formatUtcTimestamp(record.occurredAt)}
              </td>
              <td style={{ padding: "0.4rem" }}>{record.type}</td>
              <td style={{ padding: "0.4rem", fontFamily: "monospace" }}>
                {readCustomerId(record.payload) ?? "—"}
              </td>
              <td style={{ padding: "0.4rem", fontSize: "0.75rem", color: colors.textSecondary }}>{record.eventId}</td>
              <td style={{ padding: "0.4rem", fontSize: "0.75rem", color: "#444" }}>
                <pre style={{ margin: 0 }}>{JSON.stringify(record.payload, null, 0)}</pre>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
