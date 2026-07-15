ALTER TABLE "User" ADD COLUMN "lastSalesTimeZone" TEXT;
ALTER TABLE "User" ADD COLUMN "lastSalesExperienceType" TEXT;
CREATE TABLE "SalesTimezoneCache" (
  "customerId" TEXT NOT NULL PRIMARY KEY,
  "valuesJson" TEXT NOT NULL,
  "fetchedAt" DATETIME NOT NULL,
  CONSTRAINT "SalesTimezoneCache_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
