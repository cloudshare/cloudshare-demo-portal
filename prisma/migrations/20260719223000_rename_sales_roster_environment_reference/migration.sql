-- The v4 Sales roster envId is a numeric roster reference, not the opaque v3
-- Environment ID. Preserve existing correlations while naming the value honestly.
ALTER TABLE "SalesSessionParticipant" RENAME COLUMN "cloudShareEnvironmentId" TO "cloudShareRosterEnvironmentReference";
