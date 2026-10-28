import { cancellationIdentity, type SalesCancellationCommand, type SalesCancellationStore } from "@/domain/sales-session-cancellation";
export function createInMemorySalesCancellationStore(): SalesCancellationStore {
  const rows = new Map<string, SalesCancellationCommand>();
  const key = (customerId: string, commandId: string) => JSON.stringify([customerId, commandId]);
  return {
    async read(customerId, commandId) { return structuredClone(rows.get(key(customerId, commandId)) ?? null); },
    async latest(customerId, sessionId) { return structuredClone([...rows.values()].find(r => r.customerId === customerId && r.sessionId === sessionId) ?? null); },
    async admit(input) {
      const existing = rows.get(key(input.customerId, input.commandId));
      if (existing) return { kind: cancellationIdentity(existing) === cancellationIdentity(input) ? "existing" : "mismatch", command: structuredClone(existing) };
      if ([...rows.values()].some(r => r.customerId === input.customerId && (r.sessionId === input.sessionId || r.targets.some(t => input.targets.some(n => t.environmentId && n.environmentId === t.environmentId))))) return { kind: "blocked" };
      const command: SalesCancellationCommand = { ...input, revision: 1, accessState: "pending", finished: false };
      rows.set(key(input.customerId, input.commandId), structuredClone(command));
      return { kind: "new", command };
    },
    async save(command, expectedRevision) {
      const current = rows.get(key(command.customerId, command.commandId));
      if (!current || current.revision !== expectedRevision || cancellationIdentity(current) !== cancellationIdentity(command)) return false;
      rows.set(key(command.customerId, command.commandId), structuredClone({ ...command, revision: expectedRevision + 1 }));
      return true;
    },
  };
}
