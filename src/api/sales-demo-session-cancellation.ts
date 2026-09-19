import { z } from "zod";
import { randomUUID } from "node:crypto";
import type { SalesCancellationCommand, SalesCancellationStore, SalesCancellationTarget } from "@/domain/sales-session-cancellation";
import type { SalesParticipantExtensionDependencies, SalesParticipantExtensionRequest } from "./sales-participant-extension";
import type { EnvironmentController } from "@/domain/environment";
import { cloudShareWallClockToInstant, formatCloudShareWallClock } from "@/domain/cloudshare-wall-clock";
import { projectCloudShareFailureEvidence } from "@/integrations/cloudshare/diagnostic-failure-projection";
import { SalesEnvironmentResolutionError } from "@/integrations/cloudshare/sales-environment";
import { CloudShareRequestError } from "@/integrations/cloudshare/errors";
import type { SalesDelivery } from "@/integrations/cloudshare/sales-delivery";
export interface SalesCancellationDependencies extends Omit<SalesParticipantExtensionDependencies, "commands" | "provider"> {
  commands: SalesCancellationStore;
  provider(connection: Parameters<SalesParticipantExtensionDependencies["provider"]>[0]): ReturnType<SalesParticipantExtensionDependencies["provider"]> & { delivery: Pick<SalesDelivery, "deleteSession">; controller: Pick<EnvironmentController, "archiveEnvironment"> };
}
const schema = z.object({ commandId: z.string().uuid(), confirmed: z.literal(true), reconcile: z.boolean().optional(), retrySafe: z.boolean().optional(), deleteFuture: z.boolean().optional() }).strict();
const denied = (status: number, error: string) => ({ status, body: { error } });
export async function handleCancelSalesDemoSession(deps: SalesCancellationDependencies, request: SalesParticipantExtensionRequest) {
  const parsed = schema.safeParse(request.body);
  if (!parsed.success) return denied(400, "Confirm cancellation: future CloudShare Experiences are deleted; other Experiences are ended with participant environments archived. Portal history is retained.");
  let command: SalesCancellationCommand | null = null;
  const exchanges: { request: unknown; response: unknown }[] = [];
  let surface = "portal.sales";
  const record = async (outcome: "success" | "failure", message: string, error?: unknown, participantId?: string) => {
    const failure = projectCloudShareFailureEvidence(error);
    await deps.diagnostics.record({ source: "sales-session-cancellation", operation: "sales.demo_session.cancel", customerId: request.customerId, actor: request.actor, subject: { type: "sales_demo_session", id: request.sessionId }, correlationId: parsed.data.commandId, outcome, message, request: failure?.request ?? null, response: failure?.response ?? null, details: { integrationSurface: surface, attemptedOperation: "cancel_sales_session", participantId: participantId ?? null, environmentId: command?.targets.find(t => t.participantId === participantId)?.environmentId ?? null, failureMode: error instanceof Error ? error.message : null, httpExchanges: exchanges } });
    await deps.audit.write({ id: randomUUID(), occurredAt: (deps.now ?? (() => new Date()))(), customerId: request.customerId, actorType: request.actor.type, actorId: request.actor.id, actorEmail: request.actor.email, action: "sales.demo_session.cancel", subjectType: "sales_demo_session", subjectId: request.sessionId, correlationId: parsed.data.commandId, outcome, details: { participantId: participantId ?? null } });
  };
  const persist = async (next: SalesCancellationCommand) => {
    if (!await deps.commands.save(next, next.revision)) throw new Error("command_changed");
    command = { ...next, revision: next.revision + 1 };
  };
  const saveTarget = async (target: SalesCancellationTarget) => persist({ ...command!, targets: command!.targets.map(t => t.participantId === target.participantId ? target : t) });
  try {
    const session = await deps.sessions.findById?.(request.customerId, request.sessionId);
    if (!session || session.customerId !== request.customerId) return denied(404, "Sales Session was not found.");
    command = await deps.commands.read(request.customerId, parsed.data.commandId);
    if (command && (command.sessionId !== session.id || command.experienceId !== session.cloudShareSalesExperienceId)) return denied(409, "Cancellation belongs to a different Session.");
    if (command && ((!parsed.data.reconcile && !parsed.data.retrySafe && !parsed.data.deleteFuture) || command.finished)) return salesCancellationResult(command);
    if (!command && parsed.data.reconcile) return denied(404, "Cancellation command was not found.");
    const connection = await deps.connections.findByCustomerId(request.customerId);
    if (!connection || connection.customerId !== request.customerId) return denied(409, "Connect CloudShare before cancelling.");
    const { delivery, environments, controller } = deps.provider(connection);
    const readProviderSession = async () => {
      surface = "cloudshare.v4";
      const remote = await delivery.readSession(session.cloudShareSalesExperienceId);
      exchanges.push(remote);
      if (remote.id !== session.cloudShareSalesExperienceId) throw new Error("experience_correlation");
      return remote;
    };
    const futureStart = (remote: Awaited<ReturnType<typeof readProviderSession>>) => {
      const start = remote.start && remote.timeZone && cloudShareWallClockToInstant(remote.start.replace(/(T\d\d:\d\d):00(?:\.0+)?$/, "$1"), remote.timeZone);
      if (!start) throw new Error("provider_start_or_timezone_unavailable");
      return start.getTime() > (deps.now ?? (() => new Date()))().getTime();
    };
    let initialRemote: Awaited<ReturnType<typeof readProviderSession>> | undefined;
    const identify = async () => {
      const item = await deps.items.findById(session.itemId);
      if (!item || item.customerId !== request.customerId) throw new Error("item_correlation");
      surface = "cloudshare.v4";
      const remoteSession = await readProviderSession();
      initialRemote = remoteSession;
      const local = await deps.participants.list(request.customerId, session.id);
      const roster = await delivery.listParticipants(session.cloudShareSalesExperienceId);
      exchanges.push(...(roster.exchanges ?? [roster]));
      if (roster.completeness !== "complete" || roster.provenance.expectedCount !== roster.participants.length || roster.participants.length !== local.length) throw new Error("roster_incomplete_or_unbound");
      const identities: (Omit<SalesCancellationTarget, "environmentId" | "state"> & { neverLaunched: boolean })[] = [];
      for (const participant of local) {
        if (participant.customerId !== request.customerId || participant.salesDemoSessionId !== session.id) throw new Error("participant_correlation");
        const contact = await deps.records.findContact(request.customerId, participant.opportunityContactId);
        if (!contact || contact.customerId !== request.customerId || contact.opportunityId !== session.opportunityId) throw new Error("contact_correlation");
        const remote = roster.participants.filter(p => p.id === participant.cloudShareParticipantId);
        const byLocal = roster.participants.filter(p => p.customProperties.certalisSalesParticipantId === participant.id);
        const byContact = roster.participants.filter(p => p.customProperties.certalisOpportunityContactId === contact.id);
        if (remote.length !== 1 || byLocal.length !== 1 || byContact.length !== 1 || remote[0] !== byLocal[0] || remote[0] !== byContact[0] || remote[0]!.email.toLowerCase() !== contact.email.toLowerCase()) throw new Error("participant_correlation");
        identities.push({ participantId: participant.id, participantName: `${contact.firstName} ${contact.lastName}`.trim(), providerParticipantId: remote[0]!.id, contactId: contact.id, email: contact.email, projectId: item.project.id, neverLaunched: participant.participationStatus === "pending" && !participant.firstJoined && remote[0]!.participationStatus === "pending" && !remote[0]!.firstJoined && remote[0]!.environmentId === null });
      }
      if (new Set(identities.map(t => t.providerParticipantId)).size !== identities.length) throw new Error("duplicate_identity");
      return identities;
    };
    if (!command) {
      if (!session.cloudShareSalesExperienceId || session.cloudShareSalesExperienceId === "unprovisioned" || session.cloudShareSalesExperienceId.startsWith("pending:")) return denied(409, "Only a provisioned Sales Session can be cancelled.");
      const identities = await identify();
      const future = futureStart(initialRemote!);
      const targets: SalesCancellationTarget[] = [];
      for (const { neverLaunched, ...identity } of identities) {
        // Future provider Start is the agreed rule; no v3 archive eligibility applies.
        if (future) { targets.push({ ...identity, environmentId: null, state: "pending" }); continue; }
        surface = "cloudshare.v3";
        let resolved;
        try { resolved = await environments.observe({ ownerEmail: identity.email, projectId: identity.projectId }); }
        catch (error) {
          if (error instanceof SalesEnvironmentResolutionError) exchanges.push(...error.exchanges);
          if (neverLaunched && error instanceof SalesEnvironmentResolutionError && error.reason === "environment_not_found_for_project") {
            targets.push({ ...identity, environmentId: null, state: "no_environment" });
            continue;
          }
          throw error;
        }
        exchanges.push(...resolved.exchanges);
        if (!resolved.environmentId || ![2, 3, 4].includes(resolved.statusCode)) throw new Error("environment_unavailable");
        targets.push({ ...identity, environmentId: resolved.environmentId, state: resolved.statusCode === 4 ? "archived" : "pending" });
      }
      const bound = targets.filter(t => t.environmentId !== null);
      if (new Set(bound.map(t => t.environmentId)).size !== bound.length) throw new Error("environment_ambiguous");
      const now = (deps.now ?? (() => new Date()))();
      const targetEnd = formatCloudShareWallClock(now, session.timeZone);
      if (!targetEnd) throw new Error("cancellation_timezone");
      const admitted = await deps.commands.admit({ customerId: request.customerId, sessionId: session.id, commandId: parsed.data.commandId, experienceId: session.cloudShareSalesExperienceId, cancelledAt: now.toISOString(), actor: request.actor, timeZone: session.timeZone, targetEnd, targets });
      if (admitted.kind === "blocked" || admitted.kind === "mismatch") return denied(409, "Another operation owns this Session or Environment. Reconcile it before cancelling.");
      command = admitted.command!;
      if (admitted.kind !== "new") return salesCancellationResult(command);
      if (future) await persist({ ...command, deletion: { state: "pending", providerStart: initialRemote!.start!, timeZone: initialRemote!.timeZone! } });
      await record("success", "Cancellation admitted; further access is blocked.");
    }
    if (parsed.data.deleteFuture && !command.deletion) {
      const remote = await readProviderSession();
      if (!futureStart(remote)) throw new Error("experience_is_no_longer_future");
      await persist({ ...command, deletion: { state: "pending", providerStart: remote.start!, timeZone: remote.timeZone! } });
    }
    if (command.deletion) {
      if (command.deletion.state === "pending" && !parsed.data.reconcile) {
        if (!delivery.deleteSession) throw new Error("delete_adapter_unavailable");
        // Fresh authoritative Start/timezone immediately precedes the durable dispatch fence.
        const remote = await readProviderSession();
        if (!futureStart(remote)) throw new Error("experience_is_no_longer_future");
        await persist({ ...command, deletion: { state: "dispatched", providerStart: remote.start!, timeZone: remote.timeZone!, dispatchedAt: (deps.now ?? (() => new Date()))().toISOString() } });
        if (!futureStart(remote)) throw new Error("experience_is_no_longer_future");
        try { exchanges.push(await delivery.deleteSession(command.experienceId)); }
        catch (error) { await record("failure", "Experience deletion requires read-only reconciliation; do not replay.", error); }
      }
      if (command.deletion!.state === "dispatched") {
        try { await readProviderSession(); }
        catch (error) {
          if (!(error instanceof CloudShareRequestError) || error.status !== 404) throw error;
          const evidence = projectCloudShareFailureEvidence(error);
          if (evidence) exchanges.push(evidence);
          await persist({ ...command, deletion: { ...command.deletion!, state: "confirmed" }, finished: true });
        }
      }
      await record(command.finished ? "success" : "failure", command.finished ? "Future CloudShare Experience removed; all portal history retained." : "Experience deletion needs attention.");
      return salesCancellationResult(command);
    }
    for (const original of command.targets) {
      if (original.state === "archived" || original.state === "no_environment" || (original.state === "not_dispatched" && !parsed.data.retrySafe)) continue;
      let target = original;
      if (parsed.data.reconcile && target.state !== "dispatched") continue;
      try {
        surface = "cloudshare.v3";
        if (target.state === "pending" || target.state === "not_dispatched") {
          const identities = await identify();
          const current = identities.find(t => t.participantId === target.participantId);
          if (!current || current.providerParticipantId !== target.providerParticipantId || current.contactId !== target.contactId || current.email !== target.email || current.projectId !== target.projectId) throw new Error("identity_changed");
          const resolved = await environments.observe({ ownerEmail: target.email, projectId: target.projectId });
          exchanges.push(...resolved.exchanges);
          if (resolved.environmentId !== target.environmentId || ![2, 3, 4].includes(resolved.statusCode)) throw new Error("environment_identity_changed");
          if (resolved.statusCode === 4) { await saveTarget({ ...target, state: "archived" }); continue; }
          target = { ...target, state: "dispatched" };
          await saveTarget(target); // Durable no-replay reservation before invoking the typed v3 seam.
          try { const result = await controller.archiveEnvironment(target.environmentId!); exchanges.push({ request: result.request, response: result.response }); }
          catch (error) { await record("failure", "Archive requires read-only reconciliation.", error, target.participantId); }
        }
        const after = await environments.observeById(target.environmentId!);
        exchanges.push(...after.exchanges);
        if (after.environmentId === target.environmentId && after.statusCode === 4) target = { ...target, state: "archived" };
      } catch (error) {
        if (error instanceof Error && error.message === "command_changed") throw error;
        if (target.state !== "dispatched") target = { ...target, state: "not_dispatched" };
        await record("failure", "Participant cancellation needs attention.", error, target.participantId);
      }
      await saveTarget(target);
    }
    surface = "cloudshare.v4";
    if (command!.accessState === "pending" && !parsed.data.reconcile) {
      await persist({ ...command!, accessState: "dispatched" });
      try { exchanges.push(await delivery.updateSession(command!.experienceId, { end: command!.targetEnd, cancelled: true })); }
      catch (error) { await record("failure", "Experience end/label update requires read-only reconciliation.", error); }
    }
    const readback = await delivery.readSession(command!.experienceId);
    exchanges.push(readback);
    const actualEnd = readback.end && cloudShareWallClockToInstant(readback.end.replace(/(T\d\d:\d\d):00(?:\.0+)?$/, "$1"), command!.timeZone);
    const targetEnd = cloudShareWallClockToInstant(command!.targetEnd, command!.timeZone);
    if (readback.id === command!.experienceId && actualEnd && targetEnd && actualEnd.getTime() === targetEnd.getTime() && readback.labels?.includes("certalis:cancelled")) {
      await deps.sessions.updateEnd(request.customerId, session.id, command!.targetEnd);
      await persist({ ...command!, accessState: "confirmed" });
    }
    const finished = command!.accessState === "confirmed" && command!.targets.every(t => t.state === "archived" || t.state === "no_environment");
    await record(finished ? "success" : "failure", finished ? "Sales Session cancelled; history retained." : "Cancellation needs attention.");
    await persist({ ...command!, finished });
    return salesCancellationResult(command!);
  } catch (error) {
    try { await record("failure", "Cancellation needs attention.", error); } catch { /* Keep durable fences if diagnostics are unavailable. */ }
    return command ? salesCancellationResult(command) : denied(502, "Cancellation preflight failed. Inspect Support; no cancellation mutation was dispatched.");
  }
}
export function salesCancellationResult(command: SalesCancellationCommand) {
  const experienceDeleted = command.deletion?.state === "confirmed";
  return { status: command.finished ? 200 : 202, body: { commandId: command.commandId, correlationId: command.commandId, outcome: command.finished ? "cancelled" : "needs_attention", status: command.finished ? "Cancelled" : "Cancellation needs attention", cancelledAt: command.cancelledAt, experienceDeleted, deletionPending: command.deletion?.state === "pending", futureDeletionAvailable: !command.finished && !command.deletion, accessConfirmed: experienceDeleted || command.accessState === "confirmed", accessRetryable: !command.deletion && command.accessState === "pending", targets: command.targets.map(t => ({ participantId: t.participantId, participantName: t.participantName ?? "Participant", outcome: experienceDeleted ? "experience_deleted" : t.state, retryable: !command.deletion && (t.state === "not_dispatched" || t.state === "pending") })), reconcile: !command.finished } };
}
