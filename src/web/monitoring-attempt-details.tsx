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

export function MonitoringAttemptDetails({
  attempt,
  scheduledForLabel,
  onOpenSupportDiagnostics,
}: MonitoringAttemptDetailsProps) {
  const detailFields = buildMonitoringAttemptDetailFields(attempt);

  return (
    <div style={{ display: "grid", gap: "0.5rem", marginTop: "0.75rem", fontSize: "0.9rem" }}>
      <div>Candidate: {attempt.candidateEmail}</div>
      <div>Scheduled (UTC): {scheduledForLabel}</div>
      {detailFields.map((field) => (
        <div key={field.label}>
          {field.label}: {field.value}
        </div>
      ))}
      <div>
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
