ALTER TABLE "Customer" ADD COLUMN "salesSessionNameTemplate" TEXT NOT NULL DEFAULT '{account} - {opportunity} ({revision}) - {item}';
