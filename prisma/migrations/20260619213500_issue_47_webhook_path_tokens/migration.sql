PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_CloudShareConnection" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "customerId" TEXT NOT NULL,
    "apiIdCiphertext" TEXT NOT NULL,
    "apiKeyCiphertext" TEXT NOT NULL,
    "webhookSecretCiphertext" TEXT NOT NULL,
    "webhookPathToken" TEXT NOT NULL,
    "connectedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "verifiedAt" DATETIME,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CloudShareConnection_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_CloudShareConnection" (
    "id",
    "customerId",
    "apiIdCiphertext",
    "apiKeyCiphertext",
    "webhookSecretCiphertext",
    "webhookPathToken",
    "connectedAt",
    "verifiedAt",
    "updatedAt"
)
SELECT
    "id",
    "customerId",
    "apiIdCiphertext",
    "apiKeyCiphertext",
    "webhookSecretCiphertext",
    lower(hex(randomblob(18))),
    "connectedAt",
    "verifiedAt",
    "updatedAt"
FROM "CloudShareConnection";
DROP TABLE "CloudShareConnection";
ALTER TABLE "new_CloudShareConnection" RENAME TO "CloudShareConnection";
CREATE UNIQUE INDEX "CloudShareConnection_customerId_key" ON "CloudShareConnection"("customerId");
CREATE UNIQUE INDEX "CloudShareConnection_webhookPathToken_key" ON "CloudShareConnection"("webhookPathToken");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
