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

import { handleSalesTrialCredentialsHttp } from "./sales-trial-rdp-http";
it("credential POST requires same origin and participant session and never caches failures", async () => {
 for (const [origin, session, status] of [["https://foreign.test", null, 403], [undefined, null, 403], ["https://portal.test", null, 401]] as const) {
  const request = new Request("https://portal.test/api/credentials", { method: "POST", headers: origin ? { origin } : {} });
  const response = await handleSalesTrialCredentialsHttp({} as never, session, "offering", "selector", request);
  expect(response.status).toBe(status);
  expect(response.headers.get("cache-control")).toBe("no-store");
 }
});
it("credential HTTP success contains exactly username and password with no-store", async () => {
 const response = salesTrialRdpHttpResponse({ status: 200, credentials: { username: "guest", password: "test-password" } });
 expect(await response.json()).toEqual({ username: "guest", password: "test-password" });
 expect(response.headers.get("cache-control")).toBe("no-store");
});

import * as credentialRoute from "../../app/api/sales-trial/offerings/[offeringId]/rdp/[selector]/credentials/route";
it.each(["GET", "HEAD", "PUT", "PATCH", "DELETE", "OPTIONS"])("credential route rejects %s with a noncacheable static 405", async method => {
 const handler = (credentialRoute as unknown as Record<string, () => Response>)[method];
 expect(handler).toBeTypeOf("function");
 const response = await handler!();
 expect(response.status).toBe(405);
 expect(response.headers.get("cache-control")).toBe("no-store");
 expect(response.headers.get("allow")).toBe("POST");
 expect(await response.json()).toEqual({ state: "unavailable", message: "Use Show credentials from your Sales Trial page." });
});
