CREATE TABLE "SalesTrialOffering" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "customerId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "cloudShareSalesExperienceId" TEXT,
    "externalId" TEXT,
    "start" TEXT NOT NULL,
    "end" TEXT NOT NULL,
    "timeZone" TEXT NOT NULL,
    "salesProEmail" TEXT NOT NULL,
    "salesProDisplayName" TEXT,
    "status" TEXT NOT NULL,
    "attentionReason" TEXT,
    "createdAt" DATETIME NOT NULL,
    "updatedAt" DATETIME NOT NULL,
    "publishedAt" DATETIME,
    "unpublishedAt" DATETIME,
    CONSTRAINT "SalesTrialOffering_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SalesTrialOffering_customerId_itemId_fkey" FOREIGN KEY ("customerId", "itemId") REFERENCES "Item" ("customerId", "id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "SalesTrialOffering_customerId_id_key" ON "SalesTrialOffering"("customerId", "id");
CREATE INDEX "SalesTrialOffering_customerId_status_createdAt_idx" ON "SalesTrialOffering"("customerId", "status", "createdAt");
CREATE INDEX "SalesTrialOffering_customerId_itemId_idx" ON "SalesTrialOffering"("customerId", "itemId");
