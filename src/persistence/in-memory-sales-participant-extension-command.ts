import type { SalesParticipantExtensionCommand, SalesParticipantExtensionCommandStore } from "@/domain/sales-participant-extension-command";

export function createInMemorySalesParticipantExtensionCommandStore(): SalesParticipantExtensionCommandStore {
  const rows = new Map<string, SalesParticipantExtensionCommand>();
  return {
    async admit(input) {
      const key = `${input.customerId}:${input.commandId}`;
      const existing = rows.get(key);
      if (existing) {
        const same = existing.sessionId === input.sessionId && existing.targetEnd === input.targetEnd && existing.targets.map((target) => target.participantId).join(",") === input.targets.map((target) => target.participantId).join(",");
        return same ? { kind: "existing", command: existing } : { kind: "mismatch" };
      }
      const command: SalesParticipantExtensionCommand = { customerId: input.customerId, sessionId: input.sessionId, commandId: input.commandId, targetEnd: input.targetEnd, dispatchState: "admitted", revision: 1, correlationId: null, targets: input.targets.map((target) => ({ ...target, outcome: "pending", reason: null, confirmedExpiry: null })) };
      rows.set(key, command);
      return { kind: "new", command };
    },
    async markDispatching(input) {
      const key = `${input.customerId}:${input.commandId}`;
      const current = rows.get(key);
      if (!current || current.revision !== input.expectedRevision || current.dispatchState !== "admitted") return false;
      rows.set(key, { ...current, dispatchState: "dispatching", revision: current.revision + 1 });
      return true;
    },
    async settle(input) {
      const key = `${input.customerId}:${input.commandId}`;
      const current = rows.get(key);
      if (!current || current.revision !== input.expectedRevision || current.dispatchState !== "dispatching") throw new Error("extension command is no longer current");
      const byId = new Map(input.targets.map((target) => [target.participantId, target]));
      const command = { ...current, dispatchState: input.dispatchState, revision: current.revision + 1, correlationId: input.correlationId, targets: current.targets.map((target) => ({ ...target, ...(byId.get(target.participantId) ?? {}) })) };
      rows.set(key, command);
      return command;
    },
    async read(customerId, commandId) { return rows.get(`${customerId}:${commandId}`) ?? null; },
  };
}
