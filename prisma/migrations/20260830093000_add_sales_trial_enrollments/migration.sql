CREATE TABLE "SalesTrialEnrollment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "customerId" TEXT NOT NULL,
    "salesTrialOfferingId" TEXT NOT NULL,
    "portalUserId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "cloudShareParticipantId" TEXT,
    "cloudShareRosterEnvironmentReference" TEXT,
    "environmentStatus" TEXT,
    "firstJoined" TEXT,
    "status" TEXT NOT NULL,
    "attentionReason" TEXT,
    "lastLaunchedAt" DATETIME,
    "lastReconciledAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SalesTrialEnrollment_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SalesTrialEnrollment_customerId_salesTrialOfferingId_fkey" FOREIGN KEY ("customerId", "salesTrialOfferingId") REFERENCES "SalesTrialOffering" ("customerId", "id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SalesTrialEnrollment_portalUserId_fkey" FOREIGN KEY ("portalUserId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "SalesTrialEnrollment_customerId_salesTrialOfferingId_portalUserId_key" ON "SalesTrialEnrollment"("customerId", "salesTrialOfferingId", "portalUserId");
CREATE UNIQUE INDEX "SalesTrialEnrollment_cloudShareParticipantId_key" ON "SalesTrialEnrollment"("cloudShareParticipantId");
CREATE INDEX "SalesTrialEnrollment_customerId_salesTrialOfferingId_updatedAt_idx" ON "SalesTrialEnrollment"("customerId", "salesTrialOfferingId", "updatedAt");
