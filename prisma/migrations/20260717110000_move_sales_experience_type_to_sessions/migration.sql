-- The classification is selected for each Sales Enablement Session, not baked
-- into a reusable Item. Historical SalesDemoSession.type remains unchanged.
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Item" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "customerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "projectName" TEXT NOT NULL,
    "blueprintsJson" TEXT NOT NULL,
    "policyId" TEXT NOT NULL,
    "policyName" TEXT NOT NULL,
    "regionsJson" TEXT NOT NULL,
    "defaultDurationMinutes" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "archivedAt" DATETIME,
    "createdAt" DATETIME NOT NULL,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Item_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Item" ("id", "customerId", "name", "description", "projectId", "projectName", "blueprintsJson", "policyId", "policyName", "regionsJson", "defaultDurationMinutes", "status", "archivedAt", "createdAt", "updatedAt")
SELECT "id", "customerId", "name", "description", "projectId", "projectName", "blueprintsJson", "policyId", "policyName", "regionsJson", "defaultDurationMinutes", "status", "archivedAt", "createdAt", "updatedAt" FROM "Item";
DROP TABLE "Item";
ALTER TABLE "new_Item" RENAME TO "Item";
CREATE INDEX "Item_customerId_status_idx" ON "Item"("customerId", "status");
CREATE UNIQUE INDEX "Item_customerId_id_key" ON "Item"("customerId", "id");
PRAGMA foreign_key_check;
PRAGMA foreign_keys=ON;
