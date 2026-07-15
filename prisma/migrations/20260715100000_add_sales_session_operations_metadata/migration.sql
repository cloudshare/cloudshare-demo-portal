ALTER TABLE "SalesDemoSession" ADD COLUMN "sessionName" TEXT NOT NULL DEFAULT '';
ALTER TABLE "SalesDemoSession" ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 0;
-- Existing portal correlations receive a deterministic per-Opportunity revision
-- before the uniqueness index exists. createdAt is the primary ordering and id
-- is a stable tie-breaker, so historical migrations cannot collide.
UPDATE "SalesDemoSession" AS target
SET "revision" = (
  SELECT COUNT(*)
  FROM "SalesDemoSession" AS prior
  WHERE prior."customerId" = target."customerId"
    AND prior."opportunityId" = target."opportunityId"
    AND (prior."createdAt" < target."createdAt" OR (prior."createdAt" = target."createdAt" AND prior."id" <= target."id"))
);
CREATE UNIQUE INDEX "SalesDemoSession_customerId_opportunityId_revision_key" ON "SalesDemoSession"("customerId", "opportunityId", "revision");
