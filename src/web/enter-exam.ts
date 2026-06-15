import { openLabWindow, type LabWindow, type WindowOpener } from "./lab-window";

export function buildEnterExamUrl(examAttemptId: string): string {
  const params = new URLSearchParams({ examAttemptId });
  return `/enter?${params.toString()}`;
}

export function openEnterExamWindow(
  examAttemptId: string,
  opener?: WindowOpener,
): LabWindow {
  return openLabWindow(examAttemptId, buildEnterExamUrl(examAttemptId), opener);
}
