-- Align the historical revision default and operational-status index with the
-- canonical Prisma schema before issue #370's migration set is handed off.
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;

CREATE TABLE "new_SalesDemoSession" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "customerId" TEXT NOT NULL,
  "opportunityId" TEXT NOT NULL,
  "itemId" TEXT NOT NULL,
  "cloudShareSalesExperienceId" TEXT NOT NULL,
  "externalId" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "start" TEXT NOT NULL,
  "end" TEXT NOT NULL,
  "timeZone" TEXT NOT NULL,
  "salesProEmail" TEXT NOT NULL,
  "salesProDisplayName" TEXT NOT NULL,
  "registrationType" TEXT NOT NULL,
  "sendInvitations" TEXT NOT NULL,
  "sessionName" TEXT NOT NULL DEFAULT '',
  "revision" INTEGER NOT NULL DEFAULT 1,
  "operationalStatus" TEXT NOT NULL DEFAULT 'active',
  "attentionReason" TEXT,
  "experienceStatus" TEXT,
  "experienceStatusObservedAt" DATETIME,
  "createdAt" DATETIME NOT NULL,
  CONSTRAINT "SalesDemoSession_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "SalesDemoSession_customerId_opportunityId_fkey" FOREIGN KEY ("customerId", "opportunityId") REFERENCES "SalesOpportunity" ("customerId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "SalesDemoSession_customerId_itemId_fkey" FOREIGN KEY ("customerId", "itemId") REFERENCES "Item" ("customerId", "id") ON DELETE RESTRICT ON UPDATE CASCADE
);

INSERT INTO "new_SalesDemoSession" ("attentionReason", "cloudShareSalesExperienceId", "createdAt", "customerId", "end", "experienceStatus", "experienceStatusObservedAt", "externalId", "id", "itemId", "operationalStatus", "opportunityId", "registrationType", "revision", "salesProDisplayName", "salesProEmail", "sendInvitations", "sessionName", "start", "timeZone", "type")
SELECT "attentionReason", "cloudShareSalesExperienceId", "createdAt", "customerId", "end", "experienceStatus", "experienceStatusObservedAt", "externalId", "id", "itemId", "operationalStatus", "opportunityId", "registrationType", "revision", "salesProDisplayName", "salesProEmail", "sendInvitations", "sessionName", "start", "timeZone", "type" FROM "SalesDemoSession";

DROP TABLE "SalesDemoSession";
ALTER TABLE "new_SalesDemoSession" RENAME TO "SalesDemoSession";
CREATE UNIQUE INDEX "SalesDemoSession_cloudShareSalesExperienceId_key" ON "SalesDemoSession"("cloudShareSalesExperienceId");
CREATE INDEX "SalesDemoSession_customerId_opportunityId_createdAt_idx" ON "SalesDemoSession"("customerId", "opportunityId", "createdAt");
CREATE INDEX "SalesDemoSession_customerId_itemId_idx" ON "SalesDemoSession"("customerId", "itemId");
CREATE INDEX "SalesDemoSession_customerId_externalId_idx" ON "SalesDemoSession"("customerId", "externalId");
CREATE UNIQUE INDEX "SalesDemoSession_customerId_opportunityId_revision_key" ON "SalesDemoSession"("customerId", "opportunityId", "revision");

PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
