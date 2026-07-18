CREATE TABLE "SalesParticipantLaunchLink" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "customerId" TEXT NOT NULL,
  "salesDemoSessionId" TEXT NOT NULL,
  "salesSessionParticipantId" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "revokedAt" DATETIME,
  "createdAt" DATETIME NOT NULL,
  CONSTRAINT "SalesParticipantLaunchLink_salesSessionParticipantId_fkey" FOREIGN KEY ("salesSessionParticipantId") REFERENCES "SalesSessionParticipant" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "SalesParticipantLaunchLink_tokenHash_key" ON "SalesParticipantLaunchLink"("tokenHash");
CREATE INDEX "SalesParticipantLaunchLink_customerId_salesDemoSessionId_salesSessionParticipantId_idx" ON "SalesParticipantLaunchLink"("customerId", "salesDemoSessionId", "salesSessionParticipantId");
CREATE UNIQUE INDEX "SalesParticipantLaunchLink_one_active_per_participant" ON "SalesParticipantLaunchLink"("customerId", "salesDemoSessionId", "salesSessionParticipantId") WHERE "revokedAt" IS NULL;
