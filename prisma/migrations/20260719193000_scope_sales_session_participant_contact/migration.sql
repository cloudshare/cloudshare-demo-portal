-- The Contact relation must be Customer-scoped: Contact IDs are provider-owned
-- values and cannot be trusted as globally unique across Customer connections.
CREATE UNIQUE INDEX "OpportunityContact_customerId_id_key" ON "OpportunityContact"("customerId", "id");

PRAGMA foreign_keys=OFF;

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
  CONSTRAINT "SalesSessionParticipant_salesDemoSessionId_fkey" FOREIGN KEY ("salesDemoSessionId") REFERENCES "SalesDemoSession" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "SalesSessionParticipant_customerId_opportunityContactId_fkey" FOREIGN KEY ("customerId", "opportunityContactId") REFERENCES "OpportunityContact" ("customerId", "id") ON DELETE RESTRICT ON UPDATE CASCADE
);

INSERT INTO "new_SalesSessionParticipant" ("id", "customerId", "salesDemoSessionId", "opportunityContactId", "cloudShareParticipantId", "invitationStatus", "lastInvitedAt", "invitedBy", "participationStatus", "firstJoined", "cloudShareEnvironmentId", "environmentStatus", "environmentStatusCode", "environmentObservedAt", "lastReconciledAt", "createdAt", "updatedAt")
SELECT "id", "customerId", "salesDemoSessionId", "opportunityContactId", "cloudShareParticipantId", "invitationStatus", "lastInvitedAt", "invitedBy", "participationStatus", "firstJoined", "cloudShareEnvironmentId", "environmentStatus", "environmentStatusCode", "environmentObservedAt", "lastReconciledAt", "createdAt", "updatedAt" FROM "SalesSessionParticipant";

DROP TABLE "SalesSessionParticipant";
ALTER TABLE "new_SalesSessionParticipant" RENAME TO "SalesSessionParticipant";

CREATE UNIQUE INDEX "SalesSessionParticipant_cloudShareParticipantId_key" ON "SalesSessionParticipant"("cloudShareParticipantId");
CREATE UNIQUE INDEX "SalesSessionParticipant_customerId_salesDemoSessionId_opportunityContactId_key" ON "SalesSessionParticipant"("customerId", "salesDemoSessionId", "opportunityContactId");
CREATE INDEX "SalesSessionParticipant_customerId_salesDemoSessionId_updatedAt_idx" ON "SalesSessionParticipant"("customerId", "salesDemoSessionId", "updatedAt");

PRAGMA foreign_key_check;
PRAGMA foreign_keys=ON;
