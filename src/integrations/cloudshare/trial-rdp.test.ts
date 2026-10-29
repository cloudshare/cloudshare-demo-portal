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
