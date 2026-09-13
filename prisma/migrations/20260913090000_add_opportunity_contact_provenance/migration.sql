ALTER TABLE "OpportunityContact" ADD COLUMN "normalizedEmail" TEXT NOT NULL DEFAULT '';
ALTER TABLE "OpportunityContact" ADD COLUMN "source" TEXT NOT NULL DEFAULT 'relationship';
ALTER TABLE "OpportunityContact" ADD COLUMN "syncStatus" TEXT NOT NULL DEFAULT 'not_applicable';
ALTER TABLE "OpportunityContact" ADD COLUMN "sourceSessionId" TEXT;

UPDATE "OpportunityContact" SET "normalizedEmail" = lower(trim("email")) WHERE "normalizedEmail" = '';

CREATE INDEX "OpportunityContact_customerId_opportunityId_normalizedEmail_idx"
  ON "OpportunityContact"("customerId", "opportunityId", "normalizedEmail");
