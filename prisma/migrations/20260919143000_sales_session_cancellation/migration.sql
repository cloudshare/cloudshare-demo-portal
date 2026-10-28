ALTER TABLE "SalesDemoSession" ADD COLUMN "cancellationRequestedAt" DATETIME;
ALTER TABLE "SalesParticipantExtensionCommand" ADD COLUMN "operation" TEXT NOT NULL DEFAULT 'extension';
