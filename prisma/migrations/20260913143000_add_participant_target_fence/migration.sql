ALTER TABLE "SalesParticipantAddCommand" ADD COLUMN "targetKey" TEXT NOT NULL DEFAULT '';

UPDATE "SalesParticipantAddCommand"
SET "targetKey" = 'legacy-command:' || "commandId"
WHERE "targetKey" = '';

CREATE UNIQUE INDEX "SalesParticipantAddCommand_customerId_sessionId_targetKey_key"
ON "SalesParticipantAddCommand"("customerId", "sessionId", "targetKey");
