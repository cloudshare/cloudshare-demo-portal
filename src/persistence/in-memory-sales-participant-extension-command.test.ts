import { describe, expect, it } from "vitest";
import { createInMemorySalesParticipantExtensionCommandStore } from "./in-memory-sales-participant-extension-command";
export const admission = {
  customerId: "customer-a", sessionId: "session-a", commandId: "cmd-1", experienceId: "experience", timeZone: "UTC", selectionKey: "all",
  targets: [{ participantId: "p1", participantRevision: "r1", providerParticipantId: "provider-p1", contactId: "contact", email: "person@example.com", projectId: "project", environmentId: "v3-env-1", preExpiry: "2026-09-18T10:00:00Z" }],
};
describe("Sales participant extension command store", () => {
  it("fences overlapping commands and preserves dispatch through stale writes and replay", async () => {
    const store = createInMemorySalesParticipantExtensionCommandStore();
    const first = await store.admit(admission);
    expect(first.kind).toBe("new");
    expect((await store.admit({ ...admission, commandId: "cmd-2" })).kind).toBe("blocked");
    const command = first.command!;
    const dispatched = { ...command, targets: command.targets.map(target => ({ ...target, state: "dispatched" as const })) };
    expect(await store.save(dispatched, command.revision)).toBe(true);
    expect(await store.save(command, command.revision)).toBe(false);
    expect((await store.read(admission.customerId, admission.commandId))?.targets[0]?.state).toBe("dispatched");
    expect((await store.admit({ ...admission, targets: [{ ...admission.targets[0]!, environmentId: "other" }] })).kind).toBe("mismatch");
    expect(await store.read("other-customer", admission.commandId)).toBeNull();
  });
});
