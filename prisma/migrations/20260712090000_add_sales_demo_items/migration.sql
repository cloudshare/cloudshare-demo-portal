CREATE TABLE "DemoItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "customerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "projectName" TEXT NOT NULL,
    "blueprintsJson" TEXT NOT NULL,
    "policyId" TEXT NOT NULL,
    "policyName" TEXT NOT NULL,
    "regionId" TEXT NOT NULL,
    "regionName" TEXT NOT NULL,
    "salesExperienceType" TEXT NOT NULL,
    "defaultDurationMinutes" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "archivedAt" DATETIME,
    "createdAt" DATETIME NOT NULL,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "DemoItem_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "DemoItem_customerId_status_idx" ON "DemoItem"("customerId", "status");
