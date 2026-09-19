export interface SalesParticipantExtensionIdentity {
  readonly participantId: string;
  readonly participantRevision: string;
  readonly providerParticipantId: string;
  readonly contactId: string;
  readonly email: string;
  readonly projectId: string;
  readonly environmentId: string;
  readonly preExpiry: string;
}
export interface SalesParticipantExtensionTarget extends SalesParticipantExtensionIdentity {
  readonly state: "pending" | "dispatched" | "confirmed" | "not_dispatched";
  readonly reason: "readback_required" | "provider_unconfirmed" | "preflight_failed" | null;
  readonly confirmedExpiry: string | null;
}
export interface SalesParticipantExtensionAdmission {
  readonly customerId: string;
  readonly sessionId: string;
  readonly commandId: string;
  readonly experienceId: string;
  readonly selectionKey: string;
  readonly timeZone: string;
  readonly targets: readonly SalesParticipantExtensionIdentity[];
}
export interface SalesParticipantExtensionCommand extends Omit<SalesParticipantExtensionAdmission, "targets"> {
  readonly revision: number;
  readonly targets: readonly SalesParticipantExtensionTarget[];
  readonly targetEnd: string | null;
  readonly accessState: "pending" | "dispatched" | "confirmed";
  readonly finished: boolean;
}
export interface SalesParticipantExtensionCommandStore {
  admit(input: SalesParticipantExtensionAdmission): Promise<{ kind: "new" | "existing" | "mismatch" | "blocked"; command?: SalesParticipantExtensionCommand }>;
  read(customerId: string, commandId: string): Promise<SalesParticipantExtensionCommand | null>;
  latest(customerId: string, sessionId: string): Promise<SalesParticipantExtensionCommand | null>;
  /** Atomic revision check; all ambiguity fences remain until finished. */
  save(command: SalesParticipantExtensionCommand, expectedRevision: number): Promise<boolean>;
}
export function extensionIdentity(input: SalesParticipantExtensionAdmission): string {
  return JSON.stringify([input.customerId, input.sessionId, input.commandId, input.experienceId, input.timeZone, input.selectionKey,
    [...input.targets].sort((a, b) => a.participantId.localeCompare(b.participantId)).map(t => [t.participantId, t.participantRevision, t.providerParticipantId, t.contactId, t.email, t.projectId, t.environmentId, t.preExpiry])]);
}
export function newExtensionCommand(input: SalesParticipantExtensionAdmission): SalesParticipantExtensionCommand {
  return { ...input, revision: 1, targets: [...input.targets].sort((a, b) => a.participantId.localeCompare(b.participantId)).map(t => ({ ...t, state: "pending", reason: null, confirmedExpiry: null })), targetEnd: null, accessState: "pending", finished: false };
}
