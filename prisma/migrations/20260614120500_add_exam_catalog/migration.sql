-- CreateTable
CREATE TABLE "Exam" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "customerId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "timeLimitMinutes" INTEGER NOT NULL,
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
    "regionId" TEXT NOT NULL,
    "regionName" TEXT NOT NULL,
    "policyId" TEXT NOT NULL,
    "policyName" TEXT NOT NULL,
    "instructorId" TEXT NOT NULL,
    "instructorName" TEXT NOT NULL,
    CONSTRAINT "Exam_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "Exam_customerId_status_idx" ON "Exam"("customerId", "status");
