ALTER TABLE "SalesDemoSession" ADD COLUMN "operationalStatus" TEXT NOT NULL DEFAULT 'active';
ALTER TABLE "SalesDemoSession" ADD COLUMN "attentionReason" TEXT;
CREATE INDEX "SalesDemoSession_customerId_operationalStatus_createdAt_idx" ON "SalesDemoSession"("customerId", "operationalStatus", "createdAt");
