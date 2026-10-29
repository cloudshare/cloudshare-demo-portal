import { expect, it } from "vitest";
import { salesTrialRdpHttpResponse } from "./sales-trial-rdp-http";
it("serves only the file as an attachment and prevents storage on every outcome", async () => {
 const success = salesTrialRdpHttpResponse({ status: 200, file: "full address:s:host\r\n" });
 expect(await success.text()).toBe("full address:s:host\r\n");
 expect(success.headers.get("content-disposition")).toBe('attachment; filename="trial-desktop.rdp"');
 expect(success.headers.get("content-type")).toBe("application/rdp");
 for (const status of [200, 401, 404, 409, 502]) expect(salesTrialRdpHttpResponse({ status, body: { state: "unavailable" } }).headers.get("cache-control")).toBe("no-store");
});
import { handleSalesTrialRdpHttp } from "./sales-trial-rdp-http";
it("rejects missing and nonparticipant sessions before repository or provider access", async () => {
 for (const session of [null, { role: "admin", customerId: "customer", userId: "admin" }]) {
  const response = await handleSalesTrialRdpHttp({} as never, session as never, "offering", "selector");
  expect(response.status).toBe(401);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(await response.text()).not.toContain("selector");
 }
});
