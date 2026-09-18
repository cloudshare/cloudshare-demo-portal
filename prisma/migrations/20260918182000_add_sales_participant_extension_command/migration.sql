CREATE TABLE "SalesParticipantExtensionCommand" (
  "customerId" TEXT NOT NULL,
  "commandId" TEXT NOT NULL,
  "sessionId" TEXT NOT NULL,
  "targetEnd" TEXT NOT NULL,
  "dispatchState" TEXT NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "correlationId" TEXT,
  "createdAt" DATETIME NOT NULL,
  "updatedAt" DATETIME NOT NULL,
  PRIMARY KEY ("customerId", "commandId"),
  CONSTRAINT "SalesParticipantExtensionCommand_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "SalesParticipantExtensionCommand_customerId_sessionId_fkey" FOREIGN KEY ("customerId", "sessionId") REFERENCES "SalesDemoSession" ("customerId", "id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE TABLE "SalesParticipantExtensionTarget" (
  "customerId" TEXT NOT NULL,
  "commandId" TEXT NOT NULL,
  "salesSessionParticipantId" TEXT NOT NULL,
  "participantRevision" TEXT NOT NULL,
  "environmentId" TEXT NOT NULL,
  "preExpiry" TEXT NOT NULL,
  "outcome" TEXT NOT NULL,
  "reason" TEXT,
  "confirmedExpiry" TEXT,
  PRIMARY KEY ("customerId", "commandId", "salesSessionParticipantId"),
  CONSTRAINT "SalesParticipantExtensionTarget_command_fkey" FOREIGN KEY ("customerId", "commandId") REFERENCES "SalesParticipantExtensionCommand" ("customerId", "commandId") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "SalesParticipantExtensionTarget_participant_fkey" FOREIGN KEY ("customerId", "salesSessionParticipantId") REFERENCES "SalesSessionParticipant" ("customerId", "id") ON DELETE CASCADE ON UPDATE CASCADE
);
