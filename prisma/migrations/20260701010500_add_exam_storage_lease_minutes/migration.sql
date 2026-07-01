-- Persist CloudShare Policy storage lease retention evidence.
ALTER TABLE "Exam" ADD COLUMN "storageLeaseMinutes" INTEGER;
