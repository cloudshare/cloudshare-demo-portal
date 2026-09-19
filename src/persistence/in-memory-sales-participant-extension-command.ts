import { extensionIdentity, newExtensionCommand, type SalesParticipantExtensionCommand, type SalesParticipantExtensionCommandStore } from "@/domain/sales-participant-extension-command";
export function createInMemorySalesParticipantExtensionCommandStore(): SalesParticipantExtensionCommandStore {
  const rows = new Map<string, SalesParticipantExtensionCommand>();
  const key = (customerId: string, commandId: string) => JSON.stringify([customerId, commandId]);
  return {
    async admit(input) {
      const existing = rows.get(key(input.customerId, input.commandId));
      if (existing) return { kind: extensionIdentity(existing) === extensionIdentity(input) ? "existing" : "mismatch", command: structuredClone(existing) };
      if ([...rows.values()].some(row => row.customerId === input.customerId && !row.finished && (row.sessionId === input.sessionId || row.targets.some(t => input.targets.some(candidate => candidate.environmentId === t.environmentId || candidate.participantId === t.participantId))))) return { kind: "blocked" };
      const command = newExtensionCommand(input);
      rows.set(key(input.customerId, input.commandId), command);
      return { kind: "new", command: structuredClone(command) };
    },
    async latest(customerId, sessionId) { return structuredClone([...rows.values()].filter(row => row.customerId === customerId && row.sessionId === sessionId).at(-1) ?? null); },
    async save(command, expectedRevision) {
      const current = rows.get(key(command.customerId, command.commandId));
      if (!current || current.revision !== expectedRevision || extensionIdentity(current) !== extensionIdentity(command)) return false;
      rows.set(key(command.customerId, command.commandId), structuredClone({ ...command, revision: expectedRevision + 1 }));
      return true;
    },
    async read(customerId, commandId) { return structuredClone(rows.get(key(customerId, commandId)) ?? null); },
  };
}
