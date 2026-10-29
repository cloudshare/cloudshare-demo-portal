import { expect, it } from "vitest";
import { handleSalesTrialRdp } from "./sales-trial-rdp";
it("denies an enrollment outside the authenticated Customer before contacting CloudShare", async () => {
 const result = await handleSalesTrialRdp({ offerings: { findById: async () => null } } as never, { customerId: "foreign", userId: "user", email: "user@example.test", offeringId: "offering" });
 expect(result).toMatchObject({ status: 404, body: { state: "unavailable" } });
});
import { createCloudShareClient, createCloudShareNoopRequestObserver } from "@/integrations/cloudshare/client";
import type { SalesTrialRdpDeps } from "./sales-trial-rdp";
const now = new Date("2026-10-29T09:00:00Z");
const request = { customerId: "customer", userId: "user", email: "guest@example.test", offeringId: "offering" };
function setup() {
 const enrollment = { id: "enrollment", customerId: "customer", portalUserId: "user", salesTrialOfferingId: "offering", email: request.email, status: "active", lastLaunchedAt: now, cloudShareParticipantId: "participant", cloudShareRosterEnvironmentReference: "42", environmentStatus: "Ready" };
 const offering = { id: "offering", customerId: "customer", itemId: "item", status: "published", cloudShareSalesExperienceId: "EX-owned", start: "2026-10-29T08:00", end: null, timeZone: "UTC" };
 const vm = { id: "MC-owned", name: "My Windows desktop", os: "Windows", progress: 100, externalAddress: "203.0.113.1", status: "Running", password: "protected-password" };
 const environment = { id: "EN-owned", projectId: "PR-owned", ownerEmail: request.email, status: "ready", startTime: "Thu, 29 Oct 2026 08:00:00 GMT", expirationTime: "Fri, 30 Oct 2026 08:00:00 GMT" };
 const participant = { id: "participant", firstName: "Guest", lastName: "User", email: request.email, invitationStatus: "notSent", participationStatus: "inProgress", invitedBy: null, firstJoined: null, envId: "42", envStatus: "Ready", customProperties: [{ name: "certalisSalesTrialEnrollmentId", value: "enrollment" }, { name: "certalisSalesTrialParticipantUserId", value: "user" }] };
 const urls: string[] = [];
 const client = createCloudShareClient({ endpoints: { v4BaseUrl: "https://provider.test/v4", v3BaseUrl: "https://provider.test/api/v3" }, v3: { apiId: "test", apiKey: "test" }, tokenProvider: { getToken: async () => "test" }, observer: createCloudShareNoopRequestObserver(), http: { send: async r => {
  urls.push(r.url); const path = new URL(r.url).pathname;
  const body = path.endsWith("/participants") ? { count: 1, items: [participant] } : path.endsWith("/sales/EX-owned") ? { id: "EX-owned", status: "inProgress", end: null } : path.endsWith("/environments") ? { count: 1, items: [environment] } : path.endsWith("/environments/EN-owned") ? environment : path.endsWith("/vms") ? { count: 1, items: [vm] } : path.endsWith("/vms/MC-owned") ? vm : { rdpFileContent: "full address:s:desktop.example.test\r\n", clearTextPassword: "protected-password" };
  return { status: 200, body: JSON.stringify(body) };
 } } });
 const deps = { offerings: { findById: async () => offering }, enrollments: { findByOfferingAndPortalUser: async () => enrollment }, items: { findById: async () => ({ customerId: "customer", project: { id: "PR-owned" } }) }, connections: { findByCustomerId: async () => ({ customerId: "customer" }) }, cloudshare: { forConnection: () => client }, now: () => now } as unknown as SalesTrialRdpDeps;
 return { deps, enrollment, offering, vm, participant, environment, urls };
}
it("lists friendly Windows names and downloads only the provider file through an opaque selection", async () => {
 const { deps } = setup();
 const listed = await handleSalesTrialRdp(deps, request);
 expect(listed).toMatchObject({ status: 200, body: { machines: [{ name: "My Windows desktop", state: "ready" }] } });
 const selector = (listed.body as { machines: { selector: string }[] }).machines[0]!.selector;
 expect(JSON.stringify(listed)).not.toMatch(/MC-owned|EN-owned|protected-password/);
 const downloaded = await handleSalesTrialRdp(deps, { ...request, selector });
 expect(downloaded).toMatchObject({ status: 200, file: "full address:s:desktop.example.test\r\n" });
 expect(JSON.stringify(downloaded)).not.toContain("protected-password");
});

it.each(["customer", "user", "offering", "ended", "concluded", "expired", "no-public-ip", "preparing"])("denies download after %s changes", async change => {
 const s = setup();
 const listed = await handleSalesTrialRdp(s.deps, request);
 const selector = (listed.body as { machines: { selector: string }[] }).machines[0]!.selector;
 if (change === "customer") s.enrollment.customerId = "other";
 if (change === "user") s.enrollment.portalUserId = "other";
 if (change === "offering") s.enrollment.salesTrialOfferingId = "other";
 if (change === "ended") s.offering.status = "ended";
 if (change === "concluded") s.participant.participationStatus = "concluded";
 if (change === "expired") s.environment.expirationTime = "Wed, 28 Oct 2026 08:00:00 GMT";
 if (change === "no-public-ip") s.vm.externalAddress = "";
 if (change === "preparing") s.vm.progress = 30;
 const result = await handleSalesTrialRdp(s.deps, { ...request, selector });
 expect(result.status).toBeGreaterThanOrEqual(400);
 expect(result.file).toBeUndefined();
 expect(s.urls.some(url => url.includes("getremoteaccessfile"))).toBe(false);
});
it.each(["unpublished", "ending"])("keeps %s continued enrollment eligible", async status => {
 const s = setup(); s.offering.status = status;
 expect(await handleSalesTrialRdp(s.deps, request)).toMatchObject({ status: 200, body: { state: "ready" } });
});
it("cannot use another enrollment's selector or a supplied provider id", async () => {
 const s = setup();
 const result = await handleSalesTrialRdp(s.deps, { ...request, selector: "MC-owned" });
 expect(result.status).toBe(409);
 expect(s.urls.some(url => url.includes("getremoteaccessfile"))).toBe(false);
});
