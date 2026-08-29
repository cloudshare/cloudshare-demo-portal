DROP INDEX "User_email_key";

CREATE UNIQUE INDEX "User_customerId_email_key" ON "User"("customerId", "email");
