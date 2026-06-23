import React from "react";
import type { MonitoringAttemptView } from "@/domain/admin-monitoring";

export interface MonitoringAttemptDetailField {
  readonly label: string;
  readonly value: string;
}

export interface MonitoringAttemptDetailsProps {
  readonly attempt: MonitoringAttemptView;
  readonly scheduledForLabel: string;
  readonly onOpenSupportDiagnostics: (examAttemptId: string) => void;
}

function toDisplayValue(value: string | null | undefined): string {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : "-";
}

export function buildMonitoringAttemptDetailFields(
  attempt: Pick<
    MonitoringAttemptView,
    "id" | "examId" | "trainingId" | "experienceId" | "environmentExternalId" | "participantId"
  >,
): readonly MonitoringAttemptDetailField[] {
  const trainingId = attempt.trainingId?.trim() || null;
  const experienceId = attempt.experienceId?.trim() || trainingId;

  return [
    { label: "ExamAttempt ID", value: attempt.id },
    { label: "Exam ID", value: attempt.examId },
    { label: "Experience ID", value: toDisplayValue(experienceId) },
    ...(trainingId && trainingId !== experienceId
      ? [{ label: "Training ID", value: trainingId } satisfies MonitoringAttemptDetailField]
      : []),
    { label: "Environment", value: toDisplayValue(attempt.environmentExternalId) },
    { label: "Participant ID", value: toDisplayValue(attempt.participantId) },
  ];
}

const attemptDetailsGridStyle: React.CSSProperties = {
  display: "grid",
  gap: "0.75rem",
  marginTop: "0.9rem",
  fontSize: "0.9rem",
};

const detailPairGridStyle: React.CSSProperties = {
  display: "grid",
  gap: "0.6rem",
  gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
};

const detailPairStyle: React.CSSProperties = {
  display: "grid",
  gap: "0.2rem",
  padding: "0.65rem 0.75rem",
  border: "1px solid #e5e7eb",
  borderRadius: "6px",
  background: "#fafafa",
};

const detailLabelStyle: React.CSSProperties = {
  color: "#4b5563",
  fontSize: "0.75rem",
  fontWeight: 600,
};

const detailValueStyle: React.CSSProperties = {
  color: "#111827",
  fontWeight: 500,
  wordBreak: "break-word",
};

const actionRowStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "flex-start",
};

export function MonitoringAttemptDetails({
  attempt,
  scheduledForLabel,
  onOpenSupportDiagnostics,
}: MonitoringAttemptDetailsProps) {
  const detailFields = buildMonitoringAttemptDetailFields(attempt);

  return (
    <div style={attemptDetailsGridStyle}>
      <div style={detailPairGridStyle}>
        <div style={detailPairStyle}>
          <div style={detailLabelStyle}>Candidate</div>
          <div style={detailValueStyle}>{attempt.candidateEmail}</div>
        </div>
        <div style={detailPairStyle}>
          <div style={detailLabelStyle}>Scheduled (UTC)</div>
          <div style={detailValueStyle}>{scheduledForLabel}</div>
        </div>
      </div>
      <div style={detailPairGridStyle}>
        {detailFields.map((field) => (
          <div key={field.label} style={detailPairStyle}>
            <div style={detailLabelStyle}>{field.label}</div>
            <div style={detailValueStyle}>{field.value}</div>
          </div>
        ))}
      </div>
      <div style={actionRowStyle}>
        <button
          type="button"
          onClick={() => onOpenSupportDiagnostics(attempt.id)}
          style={{ padding: "0.35rem 0.75rem" }}
        >
          Open in Support Diagnostics
        </button>
      </div>
    </div>
  );
}
