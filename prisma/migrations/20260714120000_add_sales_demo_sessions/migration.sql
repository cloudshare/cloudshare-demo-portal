CREATE UNIQUE INDEX "Item_customerId_id_key" ON "Item"("customerId", "id");
CREATE TABLE "SalesDemoSession" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "opportunityId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "cloudShareSalesExperienceId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "start" TEXT NOT NULL,
    "end" TEXT NOT NULL,
    "timeZone" TEXT NOT NULL,
    "registrationType" TEXT NOT NULL,
    "sendInvitations" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL,
    CONSTRAINT "SalesDemoSession_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "SalesDemoSession_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SalesDemoSession_customerId_opportunityId_fkey" FOREIGN KEY ("customerId", "opportunityId") REFERENCES "SalesOpportunity" ("customerId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "SalesDemoSession_customerId_itemId_fkey" FOREIGN KEY ("customerId", "itemId") REFERENCES "Item" ("customerId", "id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "SalesDemoSession_cloudShareSalesExperienceId_key" ON "SalesDemoSession"("cloudShareSalesExperienceId");
CREATE INDEX "SalesDemoSession_customerId_opportunityId_createdAt_idx" ON "SalesDemoSession"("customerId", "opportunityId", "createdAt");
CREATE INDEX "SalesDemoSession_customerId_itemId_idx" ON "SalesDemoSession"("customerId", "itemId");
CREATE INDEX "SalesDemoSession_customerId_externalId_idx" ON "SalesDemoSession"("customerId", "externalId");
