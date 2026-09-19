import type { DiagnosticActor } from "./diagnostic-log";

export interface SalesCancellationTarget {
  readonly participantId: string;
  readonly providerParticipantId: string;
  readonly contactId: string;
  readonly email: string;
  readonly projectId: string;
  /** Opaque v3 identity, never a v4 roster environment reference. */
  readonly environmentId: string | null;
  readonly state: "pending" | "dispatched" | "archived" | "no_environment" | "not_dispatched";
}
export interface SalesCancellationAdmission {
  readonly customerId: string;
  readonly sessionId: string;
  readonly commandId: string;
  readonly experienceId: string;
  readonly cancelledAt: string;
  readonly actor: DiagnosticActor;
  readonly timeZone: string;
  readonly targetEnd: string;
  readonly targets: readonly SalesCancellationTarget[];
}
export interface SalesCancellationCommand extends SalesCancellationAdmission {
  readonly revision: number;
  readonly accessState: "pending" | "dispatched" | "confirmed";
  readonly finished: boolean;
}
export interface SalesCancellationStore {
  admit(input: SalesCancellationAdmission): Promise<{ kind: "new" | "existing" | "blocked" | "mismatch"; command?: SalesCancellationCommand }>;
  read(customerId: string, commandId: string): Promise<SalesCancellationCommand | null>;
  latest(customerId: string, sessionId: string): Promise<SalesCancellationCommand | null>;
  save(command: SalesCancellationCommand, expectedRevision: number): Promise<boolean>;
}
export function cancellationIdentity(input: SalesCancellationAdmission): string {
  return JSON.stringify([input.customerId, input.sessionId, input.commandId, input.experienceId, input.cancelledAt, input.actor, input.timeZone, input.targetEnd,
    input.targets.map(t => [t.participantId, t.providerParticipantId, t.contactId, t.email, t.projectId, t.environmentId])]);
}
