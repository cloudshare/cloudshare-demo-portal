-- Keep the admitted participant revision immutable while tracking the mutable
-- local projection revision used by later read-only reconciliation.
ALTER TABLE "SalesParticipantInvitationTarget" ADD COLUMN "projectionRevision" TEXT NOT NULL DEFAULT '';
UPDATE "SalesParticipantInvitationTarget" SET "projectionRevision" = "participantRevision";
ALTER TABLE "SalesParticipantInvitationCommand" ADD COLUMN "httpStatus" INTEGER;
ALTER TABLE "SalesParticipantInvitationCommand" ADD COLUMN "resultCode" TEXT;
