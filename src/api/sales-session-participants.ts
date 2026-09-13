import {
  createSalesParticipantInvitationWorkspace,
  createSalesParticipantWorkspace,
  handleListSalesSessionParticipants as readSalesSessionParticipants,
  handleRegisterSalesSessionParticipants as registerSalesSessionParticipants,
  type SalesParticipantInvitationDependencies,
  type SalesSessionParticipantsDependencies,
  type SalesSessionParticipantsRequest,
} from "@/application/sales-session-participants";
import { z } from "zod";

const invitationCommandSchema = z.object({
  commandId: z.string().uuid(),
  targets: z.array(z.object({
    participantId: z.string().trim().min(1),
    intent: z.enum(["invite", "resend"]),
    expectedInvitationStatus: z.enum(["notSent", "sent"]),
    participantRevision: z.string().trim().min(1),
  })).min(1).max(100).superRefine((targets, context) => {
    const ids = new Set<string>();
    targets.forEach((target, index) => {
      if (ids.has(target.participantId)) context.addIssue({ code: z.ZodIssueCode.custom, path: [index, "participantId"], message: "Duplicate participant target." });
      ids.add(target.participantId);
      if ((target.intent === "invite" && target.expectedInvitationStatus !== "notSent") || (target.intent === "resend" && target.expectedInvitationStatus !== "sent")) context.addIssue({ code: z.ZodIssueCode.custom, path: [index], message: "Invitation intent does not match expected status." });
    });
  }),
});

export { createSalesParticipantWorkspace };

/** HTTP seam: invoke the participant application module once. */
export async function handleRegisterSalesSessionParticipants(
  deps: SalesSessionParticipantsDependencies,
  request: SalesSessionParticipantsRequest,
) {
  return registerSalesSessionParticipants(deps, request);
}

/** HTTP seam: invoke the deep invitation lifecycle once. */
export async function handleInviteSalesSessionParticipants(
  deps: SalesParticipantInvitationDependencies,
  request: SalesSessionParticipantsRequest,
) {
  const parsed = invitationCommandSchema.safeParse(request.body);
  if (!parsed.success) return { status: 400, body: { error: "Provide a valid invitation command with ordered participant targets." } };
  return createSalesParticipantInvitationWorkspace(deps).submitInvitation({
    customerId: request.customerId,
    sessionId: request.sessionId,
    actor: request.actor,
    ...parsed.data,
  });
}

/** HTTP seam: invoke the participant application module once. */
export async function handleListSalesSessionParticipants(
  deps: SalesSessionParticipantsDependencies,
  request: Omit<SalesSessionParticipantsRequest, "body">,
) {
  return readSalesSessionParticipants(deps, request);
}
