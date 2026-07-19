-- Preserve the Customer boundary in the participant-to-Session relationship.
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE UNIQUE INDEX "SalesDemoSession_customerId_id_key" ON "SalesDemoSession"("customerId", "id");
CREATE TABLE "new_SalesSessionParticipant" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "customerId" TEXT NOT NULL,
    "salesDemoSessionId" TEXT NOT NULL,
    "opportunityContactId" TEXT NOT NULL,
    "cloudShareParticipantId" TEXT NOT NULL,
    "invitationStatus" TEXT NOT NULL,
    "lastInvitedAt" DATETIME,
    "invitedBy" TEXT,
    "participationStatus" TEXT NOT NULL,
    "firstJoined" TEXT,
    "cloudShareEnvironmentId" TEXT,
    "environmentStatus" TEXT,
    "environmentStatusCode" INTEGER,
    "environmentObservedAt" DATETIME,
    "lastReconciledAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SalesSessionParticipant_customerId_salesDemoSessionId_fkey" FOREIGN KEY ("customerId", "salesDemoSessionId") REFERENCES "SalesDemoSession" ("customerId", "id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SalesSessionParticipant_customerId_opportunityContactId_fkey" FOREIGN KEY ("customerId", "opportunityContactId") REFERENCES "OpportunityContact" ("customerId", "id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_SalesSessionParticipant" ("cloudShareEnvironmentId", "cloudShareParticipantId", "createdAt", "customerId", "environmentObservedAt", "environmentStatus", "environmentStatusCode", "firstJoined", "id", "invitationStatus", "invitedBy", "lastInvitedAt", "lastReconciledAt", "opportunityContactId", "participationStatus", "salesDemoSessionId", "updatedAt") SELECT "cloudShareEnvironmentId", "cloudShareParticipantId", "createdAt", "customerId", "environmentObservedAt", "environmentStatus", "environmentStatusCode", "firstJoined", "id", "invitationStatus", "invitedBy", "lastInvitedAt", "lastReconciledAt", "opportunityContactId", "participationStatus", "salesDemoSessionId", "updatedAt" FROM "SalesSessionParticipant";
DROP TABLE "SalesSessionParticipant";
ALTER TABLE "new_SalesSessionParticipant" RENAME TO "SalesSessionParticipant";
CREATE UNIQUE INDEX "SalesSessionParticipant_cloudShareParticipantId_key" ON "SalesSessionParticipant"("cloudShareParticipantId");
CREATE INDEX "SalesSessionParticipant_customerId_salesDemoSessionId_updatedAt_idx" ON "SalesSessionParticipant"("customerId", "salesDemoSessionId", "updatedAt");
CREATE UNIQUE INDEX "SalesSessionParticipant_customerId_salesDemoSessionId_opportunityContactId_key" ON "SalesSessionParticipant"("customerId", "salesDemoSessionId", "opportunityContactId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
