import { expect, it } from "vitest";
import { createCloudShareClient, createCloudShareNoopRequestObserver } from "./client";
import type { HttpRequest } from "./http";
import { createCloudShareTrialRdp } from "./trial-rdp";
export function provider(responses: unknown[]) {
 const requests: HttpRequest[] = [];
 const client = createCloudShareClient({ endpoints: { v4BaseUrl: "https://provider.test/v4", v3BaseUrl: "https://provider.test/api/v3" }, v3: { apiId: "test", apiKey: "test" }, tokenProvider: { getToken: async () => "test-token" }, observer: createCloudShareNoopRequestObserver(), http: { send: async request => { requests.push(request); return { status: 200, body: JSON.stringify(responses.shift()) }; } } });
 return { client, requests };
}
export const windows = { id: "MC-owned", name: "Windows desktop", os: "Windows", progress: 100, externalAddress: "203.0.113.1", fqdn: "host.example.test", status: "Running", password: "provider-password" };
it("discovers every VM page without returning credentials", async () => {
 const { client, requests } = provider([{ count: 2, items: [windows] }, { count: 2, items: [{ ...windows, id: "MC-second" }] }]);
 const machines = await createCloudShareTrialRdp(client).list("EN-owned");
 expect(machines).toHaveLength(2);
 expect(JSON.stringify(machines)).not.toContain("provider-password");
 expect(requests[1]!.url).toContain("Offset=1");
});
it("downloads provider file after exact VM membership read using signed v3 and required dimensions", async () => {
 const file = "full address:s:host.example.test\r\nusername:s:guest\r\n";
 const { client, requests } = provider([windows, { rdpFileContent: file, clearTextPassword: "secret-password" }]);
 expect(await createCloudShareTrialRdp(client).download("EN-owned", "MC-owned")).toBe(file);
 expect(requests.map(r => r.url)).toEqual(["https://provider.test/v4/environments/EN-owned/vms/MC-owned", "https://provider.test/api/v3/vms/actions/getremoteaccessfile?vmId=MC-owned&desktopWidth=1920&desktopHeight=1080"]);
 expect(requests[1]!.headers?.authorization).toMatch(/^cs_sha1 /);
});
it.each([
 { ...windows, id: "MC-other" },
 { ...windows, os: "Linux" },
 { ...windows, progress: 20 },
 { ...windows, status: "Suspended" },
])("never requests a file for mismatched or unavailable VM detail", async detail => {
 const { client, requests } = provider([detail]);
 await expect(createCloudShareTrialRdp(client).download("EN-owned", "MC-owned")).rejects.toThrow();
 expect(requests).toHaveLength(1);
});
it("rejects inconsistent VM pagination rather than offering partial results", async () => {
 const { client } = provider([{ count: 2, items: [windows] }, { count: 2, items: [windows] }]);
 await expect(createCloudShareTrialRdp(client).list("EN-owned")).rejects.toThrow("Incomplete VM observation");
});
it("keeps provider RDP/password evidence in the protected request observer only", async () => {
 const { createSalesTrialCloudShareObserver } = await import("@/api/sales-trial-cloudshare-diagnostics");
 const { createDiagnosticRecorder } = await import("@/domain/diagnostic-log");
 const { createInMemoryDiagnosticLogRepository } = await import("@/persistence/diagnostic-log-repository");
 const repository = createInMemoryDiagnosticLogRepository();
 const diagnostics = createDiagnosticRecorder({ repository });
 const observer = createSalesTrialCloudShareObserver({ diagnostics, customerId: "customer", actor: { type: "sales_trial_participant", id: "user" }, subject: { type: "sales_trial_enrollment", id: "enrollment" }, correlationId: "correlation", source: "sales-trial-rdp" });
 const bodies = [windows, { rdpFileContent: "full address:s:private-host\r\n", clearTextPassword: "secret-value" }];
 const client = createCloudShareClient({ endpoints: { v4BaseUrl: "https://provider.test/v4", v3BaseUrl: "https://provider.test/api/v3" }, v3: { apiId: "test", apiKey: "test" }, tokenProvider: { getToken: async () => "test-token" }, observer: { onRequest: observer.onRequest }, http: { send: async () => ({ status: 200, body: JSON.stringify(bodies.shift()) }) } });
 const file = await createCloudShareTrialRdp(client).download("EN-owned", "MC-owned");
 expect(file).not.toContain("secret-value");
 const entries = await repository.query({ customerId: "customer", limit: 20 });
 expect(JSON.stringify(entries)).toContain("secret-value");
 expect(JSON.stringify(entries)).not.toContain("cs_sha1 userapiid");
});

it.each([undefined, "New provider state", "Adding from template", "Adding from upload"])("fails closed for unconfirmed VM readiness label %s despite completed progress", async status => {
 const { client, requests } = provider([{ ...windows, status }, { rdpFileContent: "full address:s:host" }]);
 await expect(createCloudShareTrialRdp(client).download("EN-owned", "MC-owned")).rejects.toThrow();
 expect(requests).toHaveLength(1);
});

it("retains the successful but inconsistent VM page as typed protected failure evidence", async () => {
 const badPage = { count: 2, items: [windows, windows], providerEvidence: "protected-page" };
 const { client } = provider([badPage]);
 await expect(createCloudShareTrialRdp(client).list("EN-owned")).rejects.toMatchObject({ name: "CloudShareResponseError", context: { failureMode: "inconsistent_vm_page", responseStatus: 200, responseBody: badPage, path: "/v4/environments/EN-owned/vms" } });
});

it.each([undefined, null, "10.7.12.34"])("does not infer connection availability from externalAddress %s", async externalAddress => {
 const observed = { ...windows, externalAddress };
 const file = "full address:s:provider-gateway.example.test\r\n";
 const { client } = provider([{ count: 1, items: [observed] }, observed, { rdpFileContent: file }]);
 const rdp = createCloudShareTrialRdp(client);
 const machines = await rdp.list("EN-owned");
 expect(machines[0]).not.toHaveProperty("externalAddress");
 expect(await rdp.download("EN-owned", "MC-owned")).toBe(file);
});
