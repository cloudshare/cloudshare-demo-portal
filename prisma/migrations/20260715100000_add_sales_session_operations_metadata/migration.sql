ALTER TABLE "SalesDemoSession" ADD COLUMN "sessionName" TEXT NOT NULL DEFAULT '';
ALTER TABLE "SalesDemoSession" ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 1;
CREATE UNIQUE INDEX "SalesDemoSession_customerId_opportunityId_revision_key" ON "SalesDemoSession"("customerId", "opportunityId", "revision");
