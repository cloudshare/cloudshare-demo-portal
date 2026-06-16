-- Persist support diagnostics across dev-server restarts/hot reloads.
CREATE TABLE "SupportLogEntry" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "timestamp" DATETIME NOT NULL,
    "level" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "fieldsJson" TEXT NOT NULL
);

CREATE INDEX "SupportLogEntry_timestamp_idx" ON "SupportLogEntry"("timestamp");
