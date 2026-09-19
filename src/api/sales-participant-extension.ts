import { z } from "zod";
import { randomUUID } from "node:crypto";
import type { SalesParticipantExtensionCommand, SalesParticipantExtensionCommandStore, SalesParticipantExtensionIdentity, SalesParticipantExtensionTarget } from "@/domain/sales-participant-extension-command";
import type { SalesDemoSessionRepository } from "@/domain/sales-demo-session";
import type { SalesSessionParticipantRepository } from "@/domain/sales-session-participant";
import type { SalesRecordRepository } from "@/domain/sales-records";
import type { ItemRepository } from "@/domain/item";
import type { CloudShareConnectionRecord, CloudShareConnectionRepository } from "@/domain/cloudshare-connection";
import type { DiagnosticActor, DiagnosticRecorder } from "@/domain/diagnostic-log";
import type { AuditRepository } from "@/domain/audit-trail";
import { cloudShareWallClockToInstant, formatCloudShareWallClock } from "@/domain/cloudshare-wall-clock";
import { requireCompleteSalesParticipantRoster, type SalesDelivery, type SalesParticipant } from "@/integrations/cloudshare/sales-delivery";
import type { SalesEnvironmentSource } from "@/integrations/cloudshare/sales-environment";
import { projectCloudShareFailureEvidence } from "@/integrations/cloudshare/diagnostic-failure-projection";

const selectionSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("all"), excludedIds: z.array(z.string().min(1)).max(100).default([]) }).strict(),
  z.object({ mode: z.literal("selected"), participantIds: z.array(z.string().min(1)).min(1).max(100) }).strict(),
]);
const schema = z.object({ commandId: z.string().uuid(), selection: selectionSchema, reconcile: z.boolean().optional(), retrySafe: z.boolean().optional() }).strict();
export interface SalesParticipantExtensionDependencies {
  commands: SalesParticipantExtensionCommandStore;
  sessions: Pick<SalesDemoSessionRepository, "findById"> & Required<Pick<SalesDemoSessionRepository, "updateEnd">>;
  participants: Pick<SalesSessionParticipantRepository, "list">;
  records: Pick<SalesRecordRepository, "findContact">;
  items: Pick<ItemRepository, "findById">;
  connections: Pick<CloudShareConnectionRepository, "findByCustomerId">;
  provider(connection: CloudShareConnectionRecord): { delivery: Pick<SalesDelivery, "readSession" | "listParticipants"> & Required<Pick<SalesDelivery, "updateSession">>; environments: Required<SalesEnvironmentSource> };
  diagnostics: DiagnosticRecorder;
  audit: Pick<AuditRepository, "write">;
  now?: () => Date;
}
export type SalesParticipantExtensionRequest = { customerId: string; sessionId: string; actor: DiagnosticActor; body: unknown };
const denied = (status: number, error: string) => ({ status, body: { error } });

/** A durable command owns all v3 dispatches and the single access-window update.
 * Duplicate submissions only return evidence. Explicit reconciliation reads the
 * provider and may perform the still-undispatched access step; never a v3 replay. */
export async function handleExtendSalesParticipants(deps: SalesParticipantExtensionDependencies, request: SalesParticipantExtensionRequest) {
  const parsed = schema.safeParse(request.body);
  if (!parsed.success) return denied(400, "Provide an extension command and Participant selection.");
  const selection = parsed.data.selection;
  const selectionKey = JSON.stringify([selection.mode, [...new Set(selection.mode === "all" ? selection.excludedIds : selection.participantIds)].sort()]);
  let command: SalesParticipantExtensionCommand | null = null;
  const correlationId = parsed.data.commandId;
  const exchanges: { request: unknown; response: unknown }[] = [];
  let surface = "portal.sales";
  const record = async (outcome: "success" | "failure", reason: string, error?: unknown) => {
    const failure = projectCloudShareFailureEvidence(error);
    await deps.diagnostics.record({ source: "sales-participant-extension", operation: "sales.demo_session.participants.extend", customerId: request.customerId, actor: request.actor, subject: { type: "sales_demo_session", id: request.sessionId }, correlationId, outcome, message: reason, request: failure?.request ?? null, response: failure?.response ?? null, details: { integrationSurface: surface, attemptedOperation: "extend_participant_environments_and_access", httpExchanges: exchanges, failureMode: outcome === "failure" ? reason : null } });
    await deps.audit.write({ id: randomUUID(), occurredAt: (deps.now ?? (() => new Date()))(), customerId: request.customerId, actorType: request.actor.type, actorId: request.actor.id, actorEmail: request.actor.email, action: "sales.demo_session.participants.extend", subjectType: "sales_demo_session", subjectId: request.sessionId, correlationId, outcome, details: { participantCount: command?.targets.length ?? 0 } });
  };
  const persist = async (next: SalesParticipantExtensionCommand) => {
    if (!await deps.commands.save(next, next.revision)) throw new Error("command_changed");
    command = { ...next, revision: next.revision + 1 };
  };
  const targetState = async (target: SalesParticipantExtensionTarget) => {
    await persist({ ...command!, targets: command!.targets.map(t => t.participantId === target.participantId ? target : t) });
  };
  try {
    const session = await deps.sessions.findById?.(request.customerId, request.sessionId);
    if (!session || session.customerId !== request.customerId) return denied(404, "Sales Session was not found.");
    command = await deps.commands.read(request.customerId, parsed.data.commandId);
    if (command && (command.sessionId !== request.sessionId || command.selectionKey !== selectionKey || command.experienceId !== session.cloudShareSalesExperienceId || command.timeZone !== session.timeZone)) return denied(409, "This command belongs to a different selection or Session.");
    if (command && (!parsed.data.reconcile && !parsed.data.retrySafe)) return salesParticipantExtensionResult(command);
    if (command?.finished) return salesParticipantExtensionResult(command);
    if (!command && parsed.data.reconcile) return denied(404, "Extension command was not found.");
    const connection = await deps.connections.findByCustomerId(request.customerId);
    if (!connection || connection.customerId !== request.customerId) return denied(409, "Connect CloudShare before extending Participants.");
    const { delivery, environments } = deps.provider(connection);
    const item = await deps.items.findById(session.itemId);
    if (!item || item.customerId !== request.customerId) return denied(409, "The Session Item is unavailable.");
    surface = "cloudshare.v4";
    const remoteSession = await delivery.readSession(session.cloudShareSalesExperienceId);
    exchanges.push(remoteSession);
    if (remoteSession.id !== session.cloudShareSalesExperienceId) throw new Error("session_correlation");
    const local = await deps.participants.list(request.customerId, request.sessionId);
    const roster = await delivery.listParticipants(session.cloudShareSalesExperienceId);
    exchanges.push(...(roster.exchanges ?? [roster]));
    if (roster.completeness !== "complete") throw new Error("participant_roster_incomplete");
    requireCompleteSalesParticipantRoster(roster);
    const identify = async (id: string, expected?: SalesParticipantExtensionIdentity) => {
      const currentLocal = await deps.participants.list(request.customerId, request.sessionId);
      const matches = currentLocal.filter(p => p.id === id && p.customerId === request.customerId && p.salesDemoSessionId === session.id);
      if (matches.length !== 1) throw new Error("participant_correlation");
      const participant = matches[0]!;
      const contact = await deps.records.findContact(request.customerId, participant.opportunityContactId);
      if (!contact || contact.customerId !== request.customerId || contact.opportunityId !== session.opportunityId || contact.archivedAt) throw new Error("contact_correlation");
      const byProvider = roster.participants.filter(p => p.id === participant.cloudShareParticipantId);
      const byLocal = roster.participants.filter(p => p.customProperties.certalisSalesParticipantId === participant.id);
      const byContact = roster.participants.filter(p => p.customProperties.certalisOpportunityContactId === contact.id);
      const remote = byProvider[0];
      if (byProvider.length !== 1 || byLocal.length !== 1 || byContact.length !== 1 || byLocal[0] !== remote || byContact[0] !== remote || remote!.email.toLowerCase() !== contact.email.toLowerCase()) throw new Error("participant_correlation");
      if (expected && (expected.providerParticipantId !== remote!.id || expected.contactId !== contact.id || expected.email !== contact.email || expected.projectId !== item.project.id)) throw new Error("participant_identity_changed");
      return { participant, contact, remote: remote! };
    };
    if (!command) {
      if (remoteSession.status === "ended" || session.operationalStatus !== "active") return denied(409, "Only an active Sales Session can be extended.");
      const candidates = selection.mode === "selected" ? [...new Set(selection.participantIds)] : local.filter(p => p.participationStatus !== "concluded" && !selection.excludedIds.includes(p.id) && roster.participants.some(r => r.id === p.cloudShareParticipantId && eligible(r))).map(p => p.id);
      if (!candidates.length || candidates.length > 100) return denied(409, "Choose between 1 and 100 active Participants to extend.");
      const targets: SalesParticipantExtensionIdentity[] = [];
      for (const id of candidates.sort()) {
        const { participant, contact, remote } = await identify(id);
        if (participant.participationStatus === "concluded" || !eligible(remote)) return denied(409, "A selected Participant is no longer eligible. Refresh the roster.");
        surface = "cloudshare.v3";
        const before = await environments.observe({ ownerEmail: contact.email, projectId: item.project.id });
        exchanges.push(...before.exchanges);
        if (![2, 3].includes(before.statusCode) || !instant(before.expirationTime)) throw new Error("environment_ineligible");
        targets.push({ participantId: id, participantRevision: participant.updatedAt.toISOString(), providerParticipantId: remote.id, contactId: contact.id, email: contact.email, projectId: item.project.id, environmentId: before.environmentId, preExpiry: instant(before.expirationTime)!.toISOString() });
      }
      if (new Set(targets.map(t => t.environmentId)).size !== targets.length) throw new Error("environment_ambiguous");
      const admitted = await deps.commands.admit({ customerId: request.customerId, sessionId: session.id, commandId: parsed.data.commandId, selectionKey, experienceId: session.cloudShareSalesExperienceId, timeZone: session.timeZone, targets });
      if (admitted.kind === "blocked" || admitted.kind === "mismatch") return denied(409, "An extension already owns this Session or Environment. Reconcile that command before another extension.");
      command = admitted.command!;
      if (admitted.kind !== "new") return salesParticipantExtensionResult(command);
      // Retain admission evidence before the first provider mutation.
      await record("success", "Extension admitted.");
    }
    for (const original of command.targets) {
      if (original.state === "confirmed" || (original.state === "not_dispatched" && !parsed.data.retrySafe)) continue;
      let target = original;
      if (target.state === "not_dispatched") {
        // This target has durable proof that its v3 PUT was never attempted.
        target = { ...target, state: "pending", reason: null };
        await targetState(target);
      }
      if (parsed.data.reconcile && target.state === "pending") {
        await targetState({ ...target, state: "not_dispatched", reason: "preflight_failed" });
        continue;
      }
      try {
        const { participant, remote } = await identify(target.participantId, target);
        surface = "cloudshare.v3";
        if (target.state === "pending") {
          const resolved = await environments.observe({ ownerEmail: target.email, projectId: target.projectId });
          exchanges.push(...resolved.exchanges);
          if (resolved.environmentId !== target.environmentId) throw new Error("environment_identity_changed");
          // Projection reads update updatedAt; authority is the exact identity above and current eligibility/expiry.
          if (participant.participationStatus === "concluded" || !eligible(remote) || ![2, 3].includes(resolved.statusCode) || instant(resolved.expirationTime)?.toISOString() !== target.preExpiry) throw new Error("extension_preflight_changed");
          target = { ...target, state: "dispatched", reason: "readback_required" };
          await targetState(target); // Durable no-replay point, immediately before PUT.
          try { const extension = await environments.extendById(target.environmentId); exchanges.push(extension.exchange); }
          catch (error) {
            // No v3 failure class alone proves that its PUT was not dispatched.
            await record("failure", "Environment extension requires reconciliation.", error);
          }
        }
        if (target.state === "dispatched") {
          const after = await environments.observeById(target.environmentId);
          exchanges.push(...after.exchanges);
          const expiry = instant(after.expirationTime);
          target = after.environmentId === target.environmentId && [2, 3].includes(after.statusCode) && expiry && expiry.getTime() > Date.parse(target.preExpiry)
            ? { ...target, state: "confirmed", reason: null, confirmedExpiry: expiry.toISOString() }
            : { ...target, reason: "provider_unconfirmed" };
        }
      } catch (error) {
        if (error instanceof Error && error.message === "command_changed") throw error;
        target = { ...target, state: target.state === "pending" ? "not_dispatched" : target.state, reason: target.state === "pending" ? "preflight_failed" : "readback_required" };
        await record("failure", "Participant extension needs attention.", error);
      }
      await targetState(target);
    }
    const confirmed = command.targets.filter(t => t.state === "confirmed");
    if (confirmed.length) {
      surface = "cloudshare.v4";
      const current = await delivery.readSession(command.experienceId);
      exchanges.push(current);
      const currentEnd = providerEnd(current.end, command.timeZone);
      if (current.id !== command.experienceId || !currentEnd) throw new Error("access_readback_invalid");
      if (command.accessState === "pending" || (command.accessState === "confirmed" && confirmed.some(t => Date.parse(t.confirmedExpiry!) > currentEnd.getTime()))) {
        if (current.status === "ended") throw new Error("experience_ended");
        const target = new Date(Math.max(currentEnd.getTime(), ...confirmed.map(t => Date.parse(t.confirmedExpiry!))));
        // Provider schedules have minute precision. Round upward to preserve access.
        const end = formatCloudShareWallClock(new Date(Math.ceil(target.getTime() / 60000) * 60000), command.timeZone);
        if (!end || !cloudShareWallClockToInstant(end, command.timeZone)) throw new Error("access_timezone_invalid");
        await persist({ ...command, targetEnd: end, accessState: "dispatched" });
        try { exchanges.push(await delivery.updateSession(command!.experienceId, { end })); }
        catch (error) { await record("failure", "Sales Experience access update requires readback.", error); }
      }
      const readback = await delivery.readSession(command!.experienceId);
      exchanges.push(readback);
      if (readback.status !== "notStarted" && readback.status !== "inProgress") {
        // An ended Experience rejects access even if its End covers the expiry.
        // Retain the dispatched fence; reconciliation must never replay its PUT.
        if (command!.accessState === "confirmed") await persist({ ...command!, accessState: "dispatched" });
        throw new Error("experience_access_unavailable");
      }
      const actualEnd = providerEnd(readback.end, command!.timeZone);
      const targetEnd = command!.targetEnd && providerEnd(command!.targetEnd, command!.timeZone);
      if (readback.id === command!.experienceId && actualEnd && targetEnd && actualEnd >= targetEnd) {
        const projectedEnd = formatCloudShareWallClock(actualEnd, command!.timeZone);
        if (!projectedEnd) throw new Error("access_timezone_invalid");
        await deps.sessions.updateEnd(request.customerId, session.id, projectedEnd);
        await persist({ ...command!, accessState: "confirmed" });
      }
    }
    const finished = command!.targets.every(t => t.state === "confirmed" || t.state === "not_dispatched") && (!confirmed.length || command!.accessState === "confirmed");
    await record(finished && confirmed.length === command!.targets.length ? "success" : "failure", finished ? "Extension results reconciled." : "Extension is awaiting read-only reconciliation.");
    await persist({ ...command!, finished });
    return salesParticipantExtensionResult(command!);
  } catch (error) {
    try { await record("failure", "Extension requires support or read-only reconciliation.", error); } catch { /* Durable command fences remain held when evidence persistence fails. */ }
    return command ? { status: 202, body: { ...salesParticipantExtensionResult(command).body, outcome: "needs_attention", error: "Extension requires read-only reconciliation. No mutation will be replayed." } } : denied(502, "Extension preflight failed. No extension was dispatched; inspect Support before trying again.");
  }
}
function eligible(participant: SalesParticipant) { return participant.participationStatus !== "concluded" && participant.environmentId !== null && (participant.envStatus === "Ready" || participant.envStatus === "Suspended"); }
function instant(value: string): Date | null { const date = (/^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(value) || /^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} GMT$/.test(value)) ? new Date(value) : null; return date && Number.isFinite(date.getTime()) ? date : null; }
function providerEnd(value: string | null | undefined, timeZone: string) { return value ? instant(value) ?? cloudShareWallClockToInstant(value.replace(/(T\d\d:\d\d):00(?:\.0+)?$/, "$1"), timeZone) : null; }
export function salesParticipantExtensionResult(command: SalesParticipantExtensionCommand) {
  const completed = command.finished && command.targets.every(t => t.state === "confirmed") && command.accessState === "confirmed";
  return { status: completed ? 200 : 202, body: { finished: command.finished, selection: selectionFromKey(command.selectionKey), commandId: command.commandId, correlationId: command.commandId, outcome: completed ? "completed" : command.finished ? "partial" : "needs_attention", accessConfirmed: command.accessState === "confirmed", sessionEnd: command.accessState === "confirmed" ? command.targetEnd : null, timeZone: command.timeZone, targets: command.targets.map(t => ({ participantId: t.participantId, outcome: t.state === "confirmed" ? "confirmed" : t.state === "not_dispatched" ? "failed_retryable" : "needs_attention", confirmedExpiry: t.confirmedExpiry, retryable: t.state === "not_dispatched" })), reconcile: !command.finished } };
}



function selectionFromKey(key: string) { const [mode, ids] = JSON.parse(key) as [string, string[]]; return mode === 'all' ? { mode, excludedIds: ids } : { mode, participantIds: ids }; }
