export const participantAddRecovery = {
  oauthRetryDelaysMs: [2_000, 5_000, 10_000] as const,
  ambiguousReconciliationDelayMs: 120_000,
  reconciledRetryDelaysMs: [120_000, 300_000, 600_000, 900_000] as const,
};

export type ParticipantAddRecoverySignal = { readonly code?: string; readonly dispatchOutcome?: string };

export function classifyParticipantAddRecovery(signal: ParticipantAddRecoverySignal): "quick_retry" | "reconcile_only" | "stop" {
  if (signal.code === "participant_add_retryable" && signal.dispatchOutcome === "not_dispatched") return "quick_retry";
  if (signal.code === "participant_add_no_replay") return "reconcile_only";
  return "stop";
}
