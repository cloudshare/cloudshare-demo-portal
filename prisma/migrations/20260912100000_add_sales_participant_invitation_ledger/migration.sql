-- Additive invitation admission ledger. Existing participant rows are unchanged.
CREATE TABLE "SalesParticipantInvitationCommand" (
    "customerId" TEXT NOT NULL,
    "commandId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "scopeHash" TEXT NOT NULL,
    "phase" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "admissionTokenHash" TEXT,
    "admissionLeaseUntil" DATETIME,
    "correlationId" TEXT,
    "createdAt" DATETIME NOT NULL,
    "updatedAt" DATETIME NOT NULL,
    PRIMARY KEY ("customerId", "commandId"),
    CONSTRAINT "SalesParticipantInvitationCommand_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SalesParticipantInvitationCommand_customerId_sessionId_fkey" FOREIGN KEY ("customerId", "sessionId") REFERENCES "SalesDemoSession" ("customerId", "id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE TABLE "SalesParticipantInvitationTarget" (
    "customerId" TEXT NOT NULL,
    "commandId" TEXT NOT NULL,
    "salesSessionParticipantId" TEXT NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "intent" TEXT NOT NULL,
    "expectedInvitationStatus" TEXT NOT NULL,
    "participantRevision" TEXT NOT NULL,
    "outcome" TEXT,
    "reason" TEXT,
    PRIMARY KEY ("customerId", "commandId", "salesSessionParticipantId"),
    CONSTRAINT "SalesParticipantInvitationTarget_customerId_commandId_fkey" FOREIGN KEY ("customerId", "commandId") REFERENCES "SalesParticipantInvitationCommand" ("customerId", "commandId") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SalesParticipantInvitationTarget_customerId_salesSessionParticipantId_fkey" FOREIGN KEY ("customerId", "salesSessionParticipantId") REFERENCES "SalesSessionParticipant" ("customerId", "id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE TABLE "SalesParticipantInvitationFence" (
    "customerId" TEXT NOT NULL,
    "salesSessionParticipantId" TEXT NOT NULL,
    "commandId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "acquiredAt" DATETIME NOT NULL,
    PRIMARY KEY ("customerId", "salesSessionParticipantId"),
    CONSTRAINT "SalesParticipantInvitationFence_customerId_commandId_fkey" FOREIGN KEY ("customerId", "commandId") REFERENCES "SalesParticipantInvitationCommand" ("customerId", "commandId") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SalesParticipantInvitationFence_customerId_salesSessionParticipantId_fkey" FOREIGN KEY ("customerId", "salesSessionParticipantId") REFERENCES "SalesSessionParticipant" ("customerId", "id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "SalesParticipantInvitationTarget_customerId_commandId_ordinal_key" ON "SalesParticipantInvitationTarget"("customerId", "commandId", "ordinal");
CREATE UNIQUE INDEX "SalesSessionParticipant_customerId_id_key" ON "SalesSessionParticipant"("customerId", "id");
