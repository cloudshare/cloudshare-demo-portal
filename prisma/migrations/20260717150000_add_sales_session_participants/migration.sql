CREATE TABLE "SalesSessionParticipant" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "customerId" TEXT NOT NULL,
  "salesDemoSessionId" TEXT NOT NULL,
  "opportunityContactId" TEXT NOT NULL,
  "cloudShareParticipantId" TEXT NOT NULL,
  "invitationStatus" TEXT NOT NULL,
  "invitedBy" TEXT,
  "participationStatus" TEXT NOT NULL,
  "firstJoined" TEXT,
  "environmentStatus" TEXT,
  "lastReconciledAt" DATETIME NOT NULL,
  "createdAt" DATETIME NOT NULL,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "SalesSessionParticipant_salesDemoSessionId_fkey" FOREIGN KEY ("salesDemoSessionId") REFERENCES "SalesDemoSession" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "SalesSessionParticipant_cloudShareParticipantId_key" ON "SalesSessionParticipant"("cloudShareParticipantId");
CREATE UNIQUE INDEX "SalesSessionParticipant_customerId_salesDemoSessionId_opportunityContactId_key" ON "SalesSessionParticipant"("customerId", "salesDemoSessionId", "opportunityContactId");
CREATE INDEX "SalesSessionParticipant_customerId_salesDemoSessionId_updatedAt_idx" ON "SalesSessionParticipant"("customerId", "salesDemoSessionId", "updatedAt");
