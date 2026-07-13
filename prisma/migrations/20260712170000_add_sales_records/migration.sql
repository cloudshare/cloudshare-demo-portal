CREATE TABLE "SalesAccount" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "customerId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "archivedAt" DATETIME,
  "createdAt" DATETIME NOT NULL,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "SalesAccount_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "SalesAccount_customerId_updatedAt_idx" ON "SalesAccount"("customerId", "updatedAt");

CREATE TABLE "SalesOpportunity" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "customerId" TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "archivedAt" DATETIME,
  "createdAt" DATETIME NOT NULL,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "SalesOpportunity_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "SalesOpportunity_customerId_accountId_fkey" FOREIGN KEY ("customerId", "accountId") REFERENCES "SalesAccount" ("customerId", "id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "SalesOpportunity_customerId_accountId_updatedAt_idx" ON "SalesOpportunity"("customerId", "accountId", "updatedAt");
CREATE UNIQUE INDEX "SalesAccount_customerId_id_key" ON "SalesAccount"("customerId", "id");
CREATE UNIQUE INDEX "SalesOpportunity_customerId_id_key" ON "SalesOpportunity"("customerId", "id");

CREATE TABLE "OpportunityContact" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "customerId" TEXT NOT NULL,
  "opportunityId" TEXT NOT NULL,
  "firstName" TEXT NOT NULL,
  "lastName" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "OpportunityContact_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "OpportunityContact_customerId_opportunityId_fkey" FOREIGN KEY ("customerId", "opportunityId") REFERENCES "SalesOpportunity" ("customerId", "id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "OpportunityContact_customerId_opportunityId_updatedAt_idx" ON "OpportunityContact"("customerId", "opportunityId", "updatedAt");
