CREATE TABLE "CohortMonitoringObservation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "customerId" TEXT NOT NULL,
    "cohortSessionId" TEXT NOT NULL,
    "rowKey" TEXT NOT NULL,
    "signature" TEXT NOT NULL,
    "consecutiveReads" INTEGER NOT NULL DEFAULT 1,
    "observedAt" DATETIME NOT NULL
);

CREATE UNIQUE INDEX "CohortMonitoringObservation_customerId_cohortSessionId_rowKey_key"
ON "CohortMonitoringObservation"("customerId", "cohortSessionId", "rowKey");

CREATE INDEX "CohortMonitoringObservation_cohortSessionId_observedAt_idx"
ON "CohortMonitoringObservation"("cohortSessionId", "observedAt");
