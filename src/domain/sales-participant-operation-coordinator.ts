export type SalesParticipantOperation = "invite" | "resend" | "launch" | "revoke";
export type SalesParticipantOperationCapability = "email" | "launch";
export type SalesParticipantOperationDisposition = "ready" | "pending_confirmation" | "no_replay" | "confirmed" | "failed_retryable";

export type SalesParticipantOperationRequest = {
  readonly participantId: string;
  readonly capability: SalesParticipantOperationCapability;
  readonly operation: SalesParticipantOperation;
};

export type SalesParticipantOperationOutcome = {
  readonly disposition: Exclude<SalesParticipantOperationDisposition, "ready">;
  readonly correlationId?: string;
  readonly metadata?: Readonly<Record<string, string | number | boolean | null>>;
};

export type SalesParticipantOperationExecutor = {
  execute(request: SalesParticipantOperationRequest): Promise<SalesParticipantOperationOutcome>;
};

/**
 * Owns the command ordering invariant: only the same Participant and
 * capability wait on one another. Launch/revoke remain independent of email.
 * The executor is responsible for provider calls and exact diagnostics; this
 * module only coordinates typed outcomes and never retries an ambiguous write.
 */
export function createSalesParticipantOperationCoordinator(executor: SalesParticipantOperationExecutor) {
  const queues = new Map<string, Promise<unknown>>();
  const durable = new Map<string, SalesParticipantOperationOutcome>();

  async function run(request: SalesParticipantOperationRequest): Promise<SalesParticipantOperationOutcome> {
    const key = `${request.participantId}:${request.capability}`;
    const existing = durable.get(key);
    if (existing?.disposition === "pending_confirmation" || existing?.disposition === "no_replay") return existing;
    const previous = queues.get(key) ?? Promise.resolve();
    const current = previous.then(() => executor.execute(request));
    queues.set(key, current);
    try {
      const outcome = await current;
      durable.set(key, outcome);
      return outcome;
    } finally {
      if (queues.get(key) === current) queues.delete(key);
    }
  }

  function reconcile(states: ReadonlyArray<SalesParticipantOperationRequest & SalesParticipantOperationOutcome>): void {
    for (const state of states) durable.set(`${state.participantId}:${state.capability}`, state);
  }

  return { run, reconcile };
}
