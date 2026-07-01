-- Persist the CloudShare Policy storage lease used to calculate v4 training End.
ALTER TABLE "Exam" ADD COLUMN "storageLeaseMinutes" INTEGER;
