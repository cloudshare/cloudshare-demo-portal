import { createHash, randomBytes } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import { invitationOutcomes, invitationPhases, invitationResult, invitationScopeHash, type Admission, type CurrentInvitationState, type FinishInvitationCommand, type InvitationPhase, type InvitationTargetOutcome, type ParticipantInvitationProjection, type RevisionedInvitationCommand, type SalesParticipantInvitationLedger } from "@/domain/sales-participant-invitation-ledger";
import type { InvitationHandle, InvitationState, InvitationStore } from "@/domain/sales-participant-invitation-store";

const LEASE_MS = 30_000;
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const safeReasons = ["not_dispatched", "provider_rejected", "ambiguous_after_dispatch", "confirmation_required", "failed_retryable", "stale_revision", "blocked_by_fence"] as const;
const safeResultCodes = ["participant_revision_stale", "native_invitations_disabled", "participant_roster_incomplete", "participant_mapping_missing_from_cloudshare", "invitation_ledger_unavailable", "invitation_no_replay", "provider_rejected", "not_dispatched", "invitation_confirmation_required", "invitation_completed", "command_reconciled", "command_id_mismatch"] as const;
const toCommand = (row: { customerId: string; commandId: string; phase: string; revision: number; correlationId: string | null; httpStatus?: number | null; resultCode?: string | null }): RevisionedInvitationCommand => {
  if (!invitationPhases.includes(row.phase as never)) throw new Error("invalid persisted invitation phase");
  if (row.httpStatus !== undefined && row.httpStatus !== null && (!Number.isInteger(row.httpStatus) || row.httpStatus < 200 || row.httpStatus > 599)) throw new Error("invalid persisted invitation status");
  if (row.resultCode !== undefined && row.resultCode !== null && !safeResultCodes.includes(row.resultCode as never)) throw new Error("invalid persisted invitation result code");
  return { customerId: row.customerId, commandId: row.commandId, phase: row.phase as InvitationPhase, revision: row.revision, correlationId: row.correlationId, httpStatus: row.httpStatus ?? null, resultCode: row.resultCode ?? null };
};

export function createPrismaSalesParticipantInvitationLedger(prisma: PrismaClient): SalesParticipantInvitationLedger {
  const projectCommand = (row: { customerId: string; commandId: string; phase: string; revision: number; correlationId: string | null; httpStatus: number | null; resultCode: string | null; targets: readonly { salesSessionParticipantId: string; intent: string; expectedInvitationStatus: string; participantRevision: string; projectionRevision: string; outcome: string | null; reason: string | null }[] }): CurrentInvitationState => {
    const command = toCommand(row);
    const outcomes = row.targets.map((target) => {
      if (target.outcome !== null && !invitationOutcomes.includes(target.outcome as never)) throw new Error("invalid persisted invitation outcome");
      if (target.reason !== null && !safeReasons.includes(target.reason as never)) throw new Error("invalid persisted invitation reason");
      return { participantId: target.salesSessionParticipantId, outcome: target.outcome as never, reason: target.reason as typeof safeReasons[number] | null };
    });
    const targets = row.targets.map((target) => {
      if (!['invite', 'resend'].includes(target.intent) || !['notSent', 'sent'].includes(target.expectedInvitationStatus)) throw new Error("invalid persisted invitation target");
      return { participantId: target.salesSessionParticipantId, intent: target.intent as "invite" | "resend", expectedInvitationStatus: target.expectedInvitationStatus as "notSent" | "sent", participantRevision: target.participantRevision, projectionRevision: target.projectionRevision };
    });
    return { command, targets, outcome: invitationResult({ commandId: command.commandId, outcomes, correlationId: command.correlationId }) };
  };
  const finishInTransaction = async (tx: Prisma.TransactionClient, input: FinishInvitationCommand & { customerId: string; targetOutcomes: readonly InvitationTargetOutcome[]; projections?: readonly ParticipantInvitationProjection[] }) => {
    const command = await tx.salesParticipantInvitationCommand.findUniqueOrThrow({ where: { customerId_commandId: { customerId: input.customerId, commandId: input.commandId } }, include: { targets: { orderBy: { ordinal: "asc" } }, fences: true } });
    const ids = input.targetOutcomes.map((o) => o.participantId);
    const hasMatchingProjection = (target: typeof command.targets[number]) => input.projections?.some((projection) => projection.participantId === target.salesSessionParticipantId && projection.expectedParticipantRevision === target.projectionRevision) ?? false;
    const retainedBefore = new Set(command.targets.filter((target) => target.outcome === null || ["no_replay", "confirmation_required"].includes(target.outcome)).map((target) => target.salesSessionParticipantId));
    const reasonMatchesOutcome = (outcome: InvitationTargetOutcome) => outcome.outcome === "no_replay" ? outcome.reason === "ambiguous_after_dispatch"
      : outcome.outcome === "confirmation_required" ? outcome.reason === "confirmation_required"
        : outcome.outcome === "failed_retryable" ? outcome.reason !== null && ["not_dispatched", "provider_rejected", "failed_retryable", "stale_revision", "blocked_by_fence"].includes(outcome.reason)
          : outcome.reason === null;
    const legalTransition = (target: typeof command.targets[number], next: InvitationTargetOutcome) => {
      if (target.outcome === null) return target.intent === "invite" ? next.outcome !== "accepted_unconfirmed" : !["confirmed", "confirmed_by_reconciliation"].includes(next.outcome);
      if (target.outcome === "no_replay") return next.reason === (next.outcome === "no_replay" ? "ambiguous_after_dispatch" : null) && (next.outcome === "no_replay" || (target.intent === "invite" && next.outcome === "confirmed_by_reconciliation" && input.phase === "settled" && hasMatchingProjection(target)));
      if (target.outcome === "confirmation_required") return target.intent === "invite"
        ? ((next.outcome === "confirmation_required" && next.reason === "confirmation_required") || (next.outcome === "confirmed" && next.reason === null && input.expectedPhase === "evaluating_confirmation" && hasMatchingProjection(target)) || (next.outcome === "confirmed_by_reconciliation" && next.reason === null && input.phase === "settled" && hasMatchingProjection(target)))
        : ((next.outcome === "confirmation_required" && next.reason === "confirmation_required") || (next.outcome === "accepted_unconfirmed" && next.reason === null));
      return next.outcome === target.outcome && next.reason === target.reason;
    };
    const phaseIsLegal = command.phase === "dispatching" ? input.phase === "settled" && input.targetOutcomes.every((outcome) => outcome.outcome === "no_replay" || outcome.outcome === "failed_retryable")
      : command.phase === "evaluating_confirmation" ? input.phase === "settled"
        : command.phase === "settled" ? input.phase === "settled" && input.targetOutcomes.some((outcome) => outcome.outcome === "confirmed_by_reconciliation" && command.targets.some((target) => target.salesSessionParticipantId === outcome.participantId && target.intent === "invite" && ["no_replay", "confirmation_required"].includes(target.outcome ?? "")))
          : false;
    const dispatchOutcomeIsLegal = command.phase !== "dispatching" || (
      input.targetOutcomes.every((outcome) => outcome.outcome === "no_replay" && outcome.reason === "ambiguous_after_dispatch")
        ? input.httpStatus === 409 && input.resultCode === "invitation_no_replay"
        : input.targetOutcomes.every((outcome) => outcome.outcome === "failed_retryable" && outcome.reason === "not_dispatched")
          ? input.httpStatus === 502 && input.resultCode === "not_dispatched"
          : input.targetOutcomes.every((outcome) => outcome.outcome === "failed_retryable" && outcome.reason === "provider_rejected") && input.httpStatus === 502 && input.resultCode === "provider_rejected"
    );
    if (command.revision !== input.expectedRevision || command.phase !== input.expectedPhase || !phaseIsLegal || !dispatchOutcomeIsLegal || command.targets.length !== ids.length || new Set(ids).size !== ids.length || command.targets.some((target) => !ids.includes(target.salesSessionParticipantId)) || command.fences.length !== retainedBefore.size || command.fences.some((fence) => fence.commandId !== input.commandId || fence.revision !== input.expectedRevision || !retainedBefore.has(fence.salesSessionParticipantId)) || input.targetOutcomes.some((outcome) => !invitationOutcomes.includes(outcome.outcome) || !reasonMatchesOutcome(outcome) || !legalTransition(command.targets.find((target) => target.salesSessionParticipantId === outcome.participantId)!, outcome) || (["confirmed", "confirmed_by_reconciliation"].includes(outcome.outcome) && !hasMatchingProjection(command.targets.find((target) => target.salesSessionParticipantId === outcome.participantId)!)))) throw new Error("invitation command is no longer current");
    invitationResult({ commandId: input.commandId, outcomes: input.targetOutcomes, correlationId: input.correlationId });
    const commandUpdate = await tx.salesParticipantInvitationCommand.updateMany({ where: { customerId: input.customerId, commandId: input.commandId, revision: input.expectedRevision, phase: input.expectedPhase, admissionTokenHash: command.admissionTokenHash }, data: { phase: input.phase, correlationId: input.correlationId, httpStatus: input.httpStatus, resultCode: input.resultCode, revision: { increment: 1 }, updatedAt: new Date() } });
    if (commandUpdate.count !== 1) throw new Error("invitation command is no longer current");
    for (const fence of command.fences) {
      const claimed = await tx.salesParticipantInvitationFence.updateMany({ where: { customerId: input.customerId, salesSessionParticipantId: fence.salesSessionParticipantId, commandId: input.commandId, revision: input.expectedRevision }, data: { revision: { increment: 1 } } });
      if (claimed.count !== 1) throw new Error("invitation fence is no longer current");
    }
    const participantRevisionAt = new Date();
    if (input.projections) {
      if (new Set(input.projections.map((p) => p.participantId)).size !== input.projections.length || input.projections.some((p) => !retainedBefore.has(p.participantId))) throw new Error("participant projection set is invalid");
      for (const projection of input.projections) {
        const updated = await tx.salesSessionParticipant.updateMany({ where: { customerId: input.customerId, id: projection.participantId, salesDemoSessionId: command.sessionId, updatedAt: new Date(projection.expectedParticipantRevision) }, data: { cloudShareParticipantId: projection.cloudShareParticipantId, invitationStatus: projection.invitationStatus, lastInvitedAt: projection.lastInvitedAt ? new Date(projection.lastInvitedAt) : null, invitedBy: projection.invitedBy, participationStatus: projection.participationStatus, firstJoined: projection.firstJoined, cloudShareRosterEnvironmentReference: projection.cloudShareRosterEnvironmentReference, environmentStatus: projection.environmentStatus, environmentStatusCode: projection.environmentStatusCode, environmentObservedAt: projection.environmentObservedAt ? new Date(projection.environmentObservedAt) : null, environmentAttentionReason: projection.environmentAttentionReason, environmentAttentionSource: projection.environmentAttentionSource, lastReconciledAt: new Date(projection.lastReconciledAt), updatedAt: participantRevisionAt } });
        if (updated.count !== 1) throw new Error("participant projection is no longer current");
        await tx.salesParticipantInvitationTarget.update({ where: { customerId_commandId_salesSessionParticipantId: { customerId: input.customerId, commandId: input.commandId, salesSessionParticipantId: projection.participantId } }, data: { projectionRevision: participantRevisionAt.toISOString() } });
      }
    }
    for (const outcome of input.targetOutcomes) await tx.salesParticipantInvitationTarget.update({ where: { customerId_commandId_salesSessionParticipantId: { customerId: input.customerId, commandId: input.commandId, salesSessionParticipantId: outcome.participantId } }, data: { outcome: outcome.outcome, reason: outcome.reason } });
    const releasable = new Set(input.targetOutcomes.filter((outcome) => !["no_replay", "confirmation_required"].includes(outcome.outcome)).map((outcome) => outcome.participantId));
    if (releasable.size) await tx.salesParticipantInvitationFence.deleteMany({ where: { customerId: input.customerId, commandId: input.commandId, salesSessionParticipantId: { in: [...releasable] } } });
    return toCommand(await tx.salesParticipantInvitationCommand.findUniqueOrThrow({ where: { customerId_commandId: { customerId: input.customerId, commandId: input.commandId } } }));
  };
  return {
    async admitBatch(input): Promise<Admission> {
      if (!input.targets.length || new Set(input.targets.map((target) => target.participantId)).size !== input.targets.length) return { kind: "blocked", commandId: input.commandId, blockReason: "precondition_failed" };
      const scopeHash = invitationScopeHash(input);
      const token = randomBytes(18).toString("hex");
      const lease = new Date(input.at.getTime() + LEASE_MS);
      const existing = await prisma.salesParticipantInvitationCommand.findUnique({ where: { customerId_commandId: { customerId: input.customerId, commandId: input.commandId } } });
      if (existing) {
        if (existing.scopeHash !== scopeHash) return { kind: "blocked", commandId: input.commandId, blockReason: "command_id_mismatch" };
        if (!invitationPhases.includes(existing.phase as never)) throw new Error("invalid persisted invitation phase");
        return { kind: "same_command", commandId: input.commandId, command: { customerId: existing.customerId, commandId: existing.commandId, phase: existing.phase as never, revision: existing.revision, correlationId: existing.correlationId } };
      }
      try {
        const transactionResult = await prisma.$transaction(async (tx): Promise<"admitted" | "same_command"> => {
          const existing = await tx.salesParticipantInvitationCommand.findUnique({ where: { customerId_commandId: { customerId: input.customerId, commandId: input.commandId } }, include: { targets: { orderBy: { ordinal: "asc" } } } });
          if (existing) { if (existing.scopeHash !== scopeHash) throw new Error("command_id_mismatch"); return "same_command"; }
          const participants = await tx.salesSessionParticipant.findMany({ where: { customerId: input.customerId, salesDemoSessionId: input.sessionId, id: { in: input.targets.map((target) => target.participantId) } }, select: { id: true, invitationStatus: true, updatedAt: true } });
          if (participants.length !== input.targets.length || input.targets.some((target) => { const row = participants.find((candidate) => candidate.id === target.participantId); return !row || row.invitationStatus !== (target.expectedInvitationStatus === "sent" ? "sent" : "notSent") || row.updatedAt.toISOString() !== target.participantRevision; })) throw new Error("blocked");
          await tx.salesParticipantInvitationCommand.create({ data: { customerId: input.customerId, commandId: input.commandId, sessionId: input.sessionId, scopeHash, phase: "admitted", admissionTokenHash: hash(token), admissionLeaseUntil: lease, createdAt: input.at, updatedAt: input.at, targets: { create: input.targets.map((target, ordinal) => ({ ordinal, salesSessionParticipantId: target.participantId, intent: target.intent, expectedInvitationStatus: target.expectedInvitationStatus, participantRevision: target.participantRevision, projectionRevision: target.participantRevision })) } } });
          for (const target of input.targets) await tx.salesParticipantInvitationFence.create({ data: { customerId: input.customerId, salesSessionParticipantId: target.participantId, commandId: input.commandId, acquiredAt: input.at } });
          return "admitted";
        });
        if (transactionResult === "same_command") {
          const command = await prisma.salesParticipantInvitationCommand.findUniqueOrThrow({ where: { customerId_commandId: { customerId: input.customerId, commandId: input.commandId } } });
          return { kind: "same_command", commandId: input.commandId, command: toCommand(command) };
        }
        return { kind: "admitted", commandId: input.commandId, admissionToken: token };
      } catch (error) {
        if (error instanceof Error && error.message === "command_id_mismatch") return { kind: "blocked", commandId: input.commandId, blockReason: "command_id_mismatch" };
        if (error instanceof Error && error.message === "blocked") return { kind: "blocked", commandId: input.commandId, blockReason: "precondition_failed" };
        if (typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === "P2002") {
          const winner = await prisma.salesParticipantInvitationCommand.findUnique({ where: { customerId_commandId: { customerId: input.customerId, commandId: input.commandId } } });
          if (winner?.scopeHash === scopeHash) return { kind: "same_command", commandId: input.commandId, command: toCommand(winner) };
          return { kind: "blocked", commandId: input.commandId, blockReason: winner ? "command_id_mismatch" : "precondition_failed" };
        }
        throw error;
      }
    },
    async markBatchDispatching(customerId, commandId, admissionToken, expectedRevision, at) {
      return prisma.$transaction(async (tx) => {
        const command = await tx.salesParticipantInvitationCommand.findUnique({ where: { customerId_commandId: { customerId, commandId } }, include: { targets: { orderBy: { ordinal: "asc" } }, fences: true } });
        if (!command || command.revision !== expectedRevision || command.phase !== "admitted" || command.admissionTokenHash !== hash(admissionToken) || !command.admissionLeaseUntil || command.admissionLeaseUntil <= at || command.fences.length !== command.targets.length || command.targets.some((target) => !command.fences.some((fence) => fence.salesSessionParticipantId === target.salesSessionParticipantId))) throw new Error("invitation admission is no longer current");
        const updated = await tx.salesParticipantInvitationCommand.updateMany({ where: { customerId, commandId, revision: expectedRevision, phase: "admitted", admissionTokenHash: hash(admissionToken) }, data: { phase: "dispatching", revision: { increment: 1 }, updatedAt: at } });
        if (updated.count !== 1) throw new Error("invitation admission is no longer current");
        for (const fence of command.fences) { const claimed = await tx.salesParticipantInvitationFence.updateMany({ where: { customerId, salesSessionParticipantId: fence.salesSessionParticipantId, commandId, revision: expectedRevision }, data: { revision: { increment: 1 } } }); if (claimed.count !== 1) throw new Error("invitation fence is no longer current"); }
        return toCommand(await tx.salesParticipantInvitationCommand.findUniqueOrThrow({ where: { customerId_commandId: { customerId, commandId } } }));
      });
    },
    async markBatchEvaluatingConfirmation(input) {
      return prisma.$transaction(async (tx) => {
        const command = await tx.salesParticipantInvitationCommand.findUnique({ where: { customerId_commandId: { customerId: input.customerId, commandId: input.commandId } }, include: { targets: { orderBy: { ordinal: "asc" } }, fences: true } });
        const ids = input.targetOutcomes.map((outcome) => outcome.participantId);
        if (!command || command.phase !== "dispatching" || command.revision !== input.expectedRevision || command.admissionTokenHash !== hash(input.admissionToken) || command.targets.length !== ids.length || new Set(ids).size !== ids.length || command.targets.some((target) => !ids.includes(target.salesSessionParticipantId)) || command.fences.length !== ids.length || command.fences.some((fence) => fence.commandId !== input.commandId || fence.revision !== input.expectedRevision || !ids.includes(fence.salesSessionParticipantId)) || input.targetOutcomes.some((outcome) => outcome.outcome !== "confirmation_required" || outcome.reason !== "confirmation_required")) throw new Error("invitation dispatch is no longer current");
        const updated = await tx.salesParticipantInvitationCommand.updateMany({ where: { customerId: input.customerId, commandId: input.commandId, revision: input.expectedRevision, phase: "dispatching", admissionTokenHash: hash(input.admissionToken) }, data: { phase: "evaluating_confirmation", correlationId: input.correlationId, revision: { increment: 1 }, updatedAt: input.at } });
        if (updated.count !== 1) throw new Error("invitation dispatch is no longer current");
        for (const fence of command.fences) { const claimed = await tx.salesParticipantInvitationFence.updateMany({ where: { customerId: input.customerId, salesSessionParticipantId: fence.salesSessionParticipantId, commandId: input.commandId, revision: input.expectedRevision }, data: { revision: { increment: 1 } } }); if (claimed.count !== 1) throw new Error("invitation fence is no longer current"); }
        for (const outcome of input.targetOutcomes) await tx.salesParticipantInvitationTarget.update({ where: { customerId_commandId_salesSessionParticipantId: { customerId: input.customerId, commandId: input.commandId, salesSessionParticipantId: outcome.participantId } }, data: { outcome: outcome.outcome, reason: outcome.reason } });
        return toCommand(await tx.salesParticipantInvitationCommand.findUniqueOrThrow({ where: { customerId_commandId: { customerId: input.customerId, commandId: input.commandId } } }));
      });
    },
    async expireAdmitted(customerId, commandId, expectedRevision, at) {
      const updated = await prisma.$transaction(async (tx) => { const result = await tx.salesParticipantInvitationCommand.updateMany({ where: { customerId, commandId, revision: expectedRevision, phase: "admitted", admissionLeaseUntil: { lte: at } }, data: { phase: "settled", revision: { increment: 1 }, updatedAt: at } }); if (result.count !== 1) throw new Error("admitted command is no longer current"); const targets = await tx.salesParticipantInvitationTarget.findMany({ where: { customerId, commandId } }); for (const target of targets) await tx.salesParticipantInvitationTarget.update({ where: { customerId_commandId_salesSessionParticipantId: { customerId, commandId, salesSessionParticipantId: target.salesSessionParticipantId } }, data: { outcome: "failed_retryable", reason: "failed_retryable" } }); await tx.salesParticipantInvitationFence.deleteMany({ where: { customerId, commandId } }); return tx.salesParticipantInvitationCommand.findUniqueOrThrow({ where: { customerId_commandId: { customerId, commandId } } }); });
      return { customerId: updated.customerId, commandId: updated.commandId, phase: updated.phase as InvitationPhase, revision: updated.revision, correlationId: updated.correlationId };
    },
    async recoverExpiredInvitationCommand(input) {
      return prisma.$transaction(async (tx) => {
        const command = await tx.salesParticipantInvitationCommand.findUnique({ where: { customerId_commandId: { customerId: input.customerId, commandId: input.commandId } }, include: { targets: true, fences: true } });
        if (!command || command.sessionId !== input.sessionId || !["admitted", "dispatching"].includes(command.phase) || command.revision !== input.expectedRevision || !command.admissionTokenHash || !command.admissionLeaseUntil || command.admissionLeaseUntil > input.at || command.fences.length !== command.targets.length || command.fences.some((fence) => fence.revision !== input.expectedRevision)) return null;
        const expectedPhase = command.phase;
        const result = await tx.salesParticipantInvitationCommand.updateMany({
          where: { customerId: input.customerId, sessionId: input.sessionId, commandId: input.commandId, revision: input.expectedRevision, phase: expectedPhase, admissionTokenHash: command.admissionTokenHash, admissionLeaseUntil: command.admissionLeaseUntil },
          data: { phase: "settled", revision: { increment: 1 }, updatedAt: input.at },
        });
        if (result.count !== 1) return null;
        const dispatched = expectedPhase === "dispatching";
        await tx.salesParticipantInvitationTarget.updateMany({ where: { customerId: input.customerId, commandId: input.commandId }, data: { outcome: dispatched ? "no_replay" : "failed_retryable", reason: dispatched ? "ambiguous_after_dispatch" : "failed_retryable" } });
        if (dispatched) { const claimed = await tx.salesParticipantInvitationFence.updateMany({ where: { customerId: input.customerId, commandId: input.commandId, revision: input.expectedRevision }, data: { revision: { increment: 1 } } }); if (claimed.count !== command.targets.length) throw new Error("invitation fence is no longer current"); }
        if (!dispatched) await tx.salesParticipantInvitationFence.deleteMany({ where: { customerId: input.customerId, commandId: input.commandId } });
        return toCommand(await tx.salesParticipantInvitationCommand.findUniqueOrThrow({ where: { customerId_commandId: { customerId: input.customerId, commandId: input.commandId } } }));
      });
    },
    async failAdmitted(customerId, commandId, expectedRevision, at, failure) {
      const updated = await prisma.$transaction(async (tx) => { const result = await tx.salesParticipantInvitationCommand.updateMany({ where: { customerId, commandId, revision: expectedRevision, phase: "admitted" }, data: { phase: "settled", httpStatus: failure?.httpStatus, resultCode: failure?.resultCode, revision: { increment: 1 }, updatedAt: at } }); if (result.count !== 1) throw new Error("admitted command is no longer current"); const targets = await tx.salesParticipantInvitationTarget.findMany({ where: { customerId, commandId } }); for (const target of targets) await tx.salesParticipantInvitationTarget.update({ where: { customerId_commandId_salesSessionParticipantId: { customerId, commandId, salesSessionParticipantId: target.salesSessionParticipantId } }, data: { outcome: "failed_retryable", reason: failure?.reason ?? "failed_retryable" } }); await tx.salesParticipantInvitationFence.deleteMany({ where: { customerId, commandId } }); return tx.salesParticipantInvitationCommand.findUniqueOrThrow({ where: { customerId_commandId: { customerId, commandId } } }); });
      return { customerId: updated.customerId, commandId: updated.commandId, phase: updated.phase as InvitationPhase, revision: updated.revision, correlationId: updated.correlationId };
    },
    async finishBatch(input: FinishInvitationCommand & { customerId: string; targetOutcomes: readonly InvitationTargetOutcome[] }): Promise<RevisionedInvitationCommand> {
      return prisma.$transaction(async (tx) => finishInTransaction(tx, input));
    },
    async finishBatchWithParticipantProjections(input) {
      return prisma.$transaction(async (tx) => finishInTransaction(tx, input));
    },
    async readCommand(customerId, commandId): Promise<CurrentInvitationState | null> {
      const command = await prisma.salesParticipantInvitationCommand.findUnique({ where: { customerId_commandId: { customerId, commandId } }, include: { targets: { orderBy: { ordinal: "asc" } } } });
      return command ? projectCommand(command) : null;
    },
    async readCurrent(customerId, participantId): Promise<CurrentInvitationState | null> {
      const fence = await prisma.salesParticipantInvitationFence.findUnique({ where: { customerId_salesSessionParticipantId: { customerId, salesSessionParticipantId: participantId } }, select: { commandId: true } });
      if (!fence) return null;
      const command = await prisma.salesParticipantInvitationCommand.findUnique({ where: { customerId_commandId: { customerId, commandId: fence.commandId } }, include: { targets: { orderBy: { ordinal: "asc" } } } });
      return command ? projectCommand(command) : null;
    },
  };
}

type HandlePayload = { readonly customerId: string; readonly commandId: string; readonly token: string; readonly revision: number; readonly phase: InvitationPhase };
const encodeHandle = (value: HandlePayload): InvitationHandle => Buffer.from(JSON.stringify(value), "utf8").toString("base64url") as InvitationHandle;
const decodeHandle = (value: InvitationHandle): HandlePayload => {
  const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Partial<HandlePayload>;
  if (!parsed.customerId || !parsed.commandId || !parsed.token || !parsed.revision || !parsed.phase || !invitationPhases.includes(parsed.phase)) throw new Error("invalid invitation handle");
  return parsed as HandlePayload;
};
const semanticState = (value: CurrentInvitationState): InvitationState => ({
  status: value.command.phase === "evaluating_confirmation" ? "awaiting_confirmation" : value.command.phase === "settled" ? "settled" : "in_progress",
  displayPhase: value.command.phase,
  correlationId: value.command.correlationId,
  httpStatus: value.command.httpStatus ?? null,
  resultCode: value.command.resultCode ?? null,
  targets: value.targets ?? [],
  outcome: value.outcome,
});

/** Deep persistence interface. Lifecycle phases, revisions, leases, admission
 * tokens, and fence CAS rules stay inside this adapter. */
type ParticipantProjectionReader = InvitationStore["readParticipantProjections"];
export function createInvitationStoreFromLedger(ledger: SalesParticipantInvitationLedger, readParticipantProjections: ParticipantProjectionReader = async () => new Map()): InvitationStore {
  const read = async (customerId: string, commandId: string) => {
    const current = await ledger.readCommand(customerId, commandId);
    if (!current) throw new Error("invitation command was not found");
    return current;
  };
  const handleFor = (current: CurrentInvitationState, token = "retained") => encodeHandle({ customerId: current.command.customerId, commandId: current.command.commandId, token, revision: current.command.revision, phase: current.command.phase });
  return {
    async begin(input) {
      let existing = await ledger.readCommand(input.customerId, input.commandId);
      if (!existing && !input.allowNew) return { kind: "blocked", reason: "session_unavailable" };
      if (existing && ["admitted", "dispatching"].includes(existing.command.phase) && ledger.recoverExpiredInvitationCommand) {
        try { await ledger.recoverExpiredInvitationCommand({ customerId: input.customerId, sessionId: input.sessionId, commandId: input.commandId, expectedRevision: existing.command.revision, at: input.at }); }
        catch { /* Admission below retains nonterminal precedence when recovery races or storage is unavailable. */ }
      }
      const admission = await ledger.admitBatch(input);
      if (admission.kind === "blocked") return { kind: "blocked", reason: admission.blockReason };
      if (admission.kind === "admitted") return { kind: "started", handle: encodeHandle({ customerId: input.customerId, commandId: input.commandId, token: admission.admissionToken, revision: 1, phase: "admitted" }) };
      existing = await read(input.customerId, input.commandId);
      return { kind: "replay", handle: handleFor(existing), state: semanticState(existing) };
    },
    async authorizeDispatch(opaque, at) {
      const handle = decodeHandle(opaque);
      const command = await ledger.markBatchDispatching(handle.customerId, handle.commandId, handle.token, handle.revision, at);
      return encodeHandle({ ...handle, revision: command.revision, phase: command.phase });
    },
    async recordAcknowledgement(opaque, input) {
      const handle = decodeHandle(opaque);
      if (!ledger.markBatchEvaluatingConfirmation) throw new Error("invitation acknowledgement persistence is unavailable");
      const command = await ledger.markBatchEvaluatingConfirmation({ customerId: handle.customerId, commandId: handle.commandId, admissionToken: handle.token, expectedRevision: handle.revision, correlationId: input.correlationId, targetOutcomes: input.outcomes, at: input.at });
      return encodeHandle({ ...handle, revision: command.revision, phase: command.phase });
    },
    async settle(opaque, input) {
      const handle = decodeHandle(opaque);
      if (input.projections) await ledger.finishBatchWithParticipantProjections({ customerId: handle.customerId, commandId: handle.commandId, expectedRevision: handle.revision, expectedPhase: handle.phase as "dispatching" | "evaluating_confirmation" | "settled", phase: "settled", correlationId: input.correlationId, httpStatus: input.httpStatus, resultCode: input.resultCode, targetOutcomes: input.outcomes, projections: input.projections });
      else await ledger.finishBatch({ customerId: handle.customerId, commandId: handle.commandId, expectedRevision: handle.revision, expectedPhase: handle.phase as "dispatching" | "evaluating_confirmation" | "settled", phase: "settled", correlationId: input.correlationId, httpStatus: input.httpStatus, resultCode: input.resultCode, targetOutcomes: input.outcomes });
      return { status: "settled", displayPhase: "settled", correlationId: input.correlationId, httpStatus: input.httpStatus, resultCode: input.resultCode, targets: [], outcome: invitationResult({ commandId: handle.commandId, correlationId: input.correlationId, outcomes: input.outcomes }) };
    },
    async failBeforeDispatch(opaque, input) {
      const handle = decodeHandle(opaque);
      await ledger.failAdmitted(handle.customerId, handle.commandId, handle.revision, input.at, { httpStatus: input.httpStatus, resultCode: input.resultCode, reason: input.reason });
      const current = await ledger.readCommand(handle.customerId, handle.commandId);
      return current ? semanticState(current) : { status: "settled", displayPhase: "settled", correlationId: null, httpStatus: input.httpStatus, resultCode: input.resultCode, targets: [], outcome: invitationResult({ commandId: handle.commandId, correlationId: null, outcomes: [] }) };
    },
    async load(customerId, commandId) {
      const current = await ledger.readCommand(customerId, commandId);
      return current ? { handle: handleFor(current), state: semanticState(current) } : null;
    },
    readParticipantProjections,
  };
}

export function createPrismaInvitationStore(prisma: PrismaClient): InvitationStore {
  const readParticipantProjections: ParticipantProjectionReader = async (input) => {
    if (input.participantIds.length > 50 || new Set(input.participantIds).size !== input.participantIds.length) throw new Error("invalid invitation projection scope");
    if (!input.participantIds.length) return new Map();
    const fences = await prisma.salesParticipantInvitationFence.findMany({ where: { customerId: input.customerId, salesSessionParticipantId: { in: [...input.participantIds] } }, select: { salesSessionParticipantId: true, commandId: true, revision: true } });
    const commandIds = fences.map((fence) => fence.commandId);
    const commands = commandIds.length ? await prisma.salesParticipantInvitationCommand.findMany({ where: { customerId: input.customerId, sessionId: input.sessionId, commandId: { in: commandIds } }, select: { commandId: true, revision: true, correlationId: true, targets: { select: { salesSessionParticipantId: true, outcome: true, reason: true } } } }) : [];
    const commandById = new Map(commands.map((command) => [command.commandId, command]));
    const fenceByParticipant = new Map(fences.map((fence) => [fence.salesSessionParticipantId, fence]));
    const latestTargets = (await Promise.all(input.participantIds.map((participantId) => prisma.salesParticipantInvitationTarget.findMany({ where: { customerId: input.customerId, salesSessionParticipantId: participantId, command: { sessionId: input.sessionId } }, orderBy: [{ command: { updatedAt: "desc" } }, { ordinal: "asc" }], take: 1, select: { salesSessionParticipantId: true, outcome: true, reason: true, command: { select: { correlationId: true } } } })))).flat();
    const latestByParticipant = new Map(latestTargets.map((target) => [target.salesSessionParticipantId, target]));
    const safeOutcome = (value: string | null | undefined) => {
      if (value === null || value === undefined) return null;
      if (!invitationOutcomes.includes(value as never)) throw new Error("invalid persisted invitation outcome");
      return value as InvitationTargetOutcome["outcome"];
    };
    const safeReason = (value: string | null | undefined) => {
      if (value === null || value === undefined) return null;
      if (!safeReasons.includes(value as never)) throw new Error("invalid persisted invitation reason");
      return value as InvitationTargetOutcome["reason"];
    };
    return new Map(input.participantIds.map((participantId) => {
      const fence = fenceByParticipant.get(participantId);
      const command = fence ? commandById.get(fence.commandId) : undefined;
      if (fence && (!command || command.revision !== fence.revision)) throw new Error("invalid persisted invitation fence");
      const current = command?.targets.find((target) => target.salesSessionParticipantId === participantId);
      const latest = latestByParticipant.get(participantId);
      const currentOutcome = safeOutcome(current?.outcome);
      const latestOutcome = safeOutcome(latest?.outcome);
      return [participantId, { currentCommandId: command?.commandId ?? null, invitationOutcome: currentOutcome, invitationReason: currentOutcome ? safeReason(current?.reason) : null, invitationCorrelationId: command?.correlationId ?? null, latestInvitationOutcome: latestOutcome, latestInvitationReason: latestOutcome ? safeReason(latest?.reason) : null, latestInvitationCorrelationId: latest?.command.correlationId ?? null }] as const;
    }));
  };
  return createInvitationStoreFromLedger(createPrismaSalesParticipantInvitationLedger(prisma), readParticipantProjections);
}
