import type { CSSProperties } from "react";
import { colors, radius } from "./design-tokens";

export type StatusTone = "neutral" | "info" | "positive" | "warning" | "negative";

const toneColors: Record<StatusTone, { background: string; color: string }> = {
  neutral: { background: colors.neutralSoft, color: colors.neutral },
  info: { background: colors.infoSoft, color: colors.info },
  positive: { background: colors.successSoft, color: colors.success },
  warning: { background: colors.warningSoft, color: colors.warning },
  negative: { background: colors.dangerSoft, color: colors.danger },
};

export function statusBadgeStyle(tone: StatusTone): CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    padding: "0.25rem 0.65rem",
    borderRadius: radius.pill,
    fontWeight: 600,
    fontSize: "0.78rem",
    whiteSpace: "nowrap",
    ...toneColors[tone],
  };
}

export function getExamAttemptStatusTone(status: string): StatusTone {
  switch (status) {
    case "ready":
      return "info";
    case "in_progress":
    case "suspended":
      return "warning";
    case "completed":
      return "positive";
    case "expired":
    case "scheduled":
    default:
      return "neutral";
  }
}

export function getExamStatusTone(status: string): StatusTone {
  return status === "published" ? "positive" : "neutral";
}

export function getDiagnosticLevelTone(level: string): StatusTone {
  switch (level) {
    case "error":
      return "negative";
    case "warn":
      return "warning";
    default:
      return "info";
  }
}

export function getOutcomeTone(outcome: string): StatusTone {
  return outcome === "failure" ? "negative" : "positive";
}
