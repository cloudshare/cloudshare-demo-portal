-- Persist the manually authored CloudShare Experience open period.
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;

CREATE TABLE "new_Exam" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "customerId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "timeLimitMinutes" INTEGER NOT NULL,
    "storageLeaseMinutes" INTEGER,
    "openPeriodMinutes" INTEGER NOT NULL,
    "scoreRetrievalEnabled" BOOLEAN NOT NULL,
    "status" TEXT NOT NULL,
    "publishedAt" DATETIME,
    "createdAt" DATETIME NOT NULL,
    "updatedAt" DATETIME NOT NULL,
    "projectId" TEXT NOT NULL,
    "projectName" TEXT NOT NULL,
    "blueprintId" TEXT NOT NULL,
    "blueprintName" TEXT NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "snapshotName" TEXT NOT NULL,
    "allowedRegionsJson" TEXT NOT NULL,
    "policyId" TEXT NOT NULL,
    "policyName" TEXT NOT NULL,
    "instructorId" TEXT NOT NULL,
    "instructorName" TEXT NOT NULL,
    CONSTRAINT "Exam_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

INSERT INTO "new_Exam" (
    "id",
    "customerId",
    "title",
    "description",
    "timeLimitMinutes",
    "storageLeaseMinutes",
    "openPeriodMinutes",
    "scoreRetrievalEnabled",
    "status",
    "publishedAt",
    "createdAt",
    "updatedAt",
    "projectId",
    "projectName",
    "blueprintId",
    "blueprintName",
    "snapshotId",
    "snapshotName",
    "allowedRegionsJson",
    "policyId",
    "policyName",
    "instructorId",
    "instructorName"
)
SELECT
    "id",
    "customerId",
    "title",
    "description",
    "timeLimitMinutes",
    "storageLeaseMinutes",
    "timeLimitMinutes",
    "scoreRetrievalEnabled",
    "status",
    "publishedAt",
    "createdAt",
    "updatedAt",
    "projectId",
    "projectName",
    "blueprintId",
    "blueprintName",
    "snapshotId",
    "snapshotName",
    "allowedRegionsJson",
    "policyId",
    "policyName",
    "instructorId",
    "instructorName"
FROM "Exam";

DROP TABLE "Exam";
ALTER TABLE "new_Exam" RENAME TO "Exam";
CREATE INDEX "Exam_customerId_status_idx" ON "Exam"("customerId", "status");

PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
