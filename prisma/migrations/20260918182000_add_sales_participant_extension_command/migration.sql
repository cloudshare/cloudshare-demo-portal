CREATE TABLE "SalesParticipantExtensionCommand" (
  "customerId" TEXT NOT NULL, "commandId" TEXT NOT NULL, "sessionId" TEXT NOT NULL,
  "activeSessionId" TEXT, "identity" TEXT NOT NULL, "state" TEXT NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 1, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL,
  PRIMARY KEY ("customerId", "commandId"),
  FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  FOREIGN KEY ("customerId", "sessionId") REFERENCES "SalesDemoSession" ("customerId", "id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "SalesParticipantExtensionCommand_customerId_activeSessionId_key" ON "SalesParticipantExtensionCommand"("customerId", "activeSessionId");
CREATE TABLE "SalesParticipantExtensionTarget" (
  "customerId" TEXT NOT NULL, "commandId" TEXT NOT NULL, "salesSessionParticipantId" TEXT NOT NULL,
  "activeParticipantId" TEXT, "activeEnvironmentId" TEXT,
  PRIMARY KEY ("customerId", "commandId", "salesSessionParticipantId"),
  FOREIGN KEY ("customerId", "commandId") REFERENCES "SalesParticipantExtensionCommand" ("customerId", "commandId") ON DELETE CASCADE ON UPDATE CASCADE,
  FOREIGN KEY ("customerId", "salesSessionParticipantId") REFERENCES "SalesSessionParticipant" ("customerId", "id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "SalesParticipantExtensionTarget_customerId_activeParticipantId_key" ON "SalesParticipantExtensionTarget"("customerId", "activeParticipantId");
CREATE UNIQUE INDEX "SalesParticipantExtensionTarget_customerId_activeEnvironmentId_key" ON "SalesParticipantExtensionTarget"("customerId", "activeEnvironmentId");
