import { describe, expect, it, vi } from "vitest";
import { createCloudShareClient } from "./client";
import type { HttpClient } from "./http";
import { createCloudShareSalesDelivery } from "./sales-delivery";

function deliveryForRoster(body: unknown) {
  const http: HttpClient = { async send() { return { status: 200, body: JSON.stringify(body) }; } };
  return createCloudShareSalesDelivery(createCloudShareClient({
    http,
    endpoints: { v4BaseUrl: "https://api.accelerate.cloudshare.com/v4", v3BaseUrl: "https://use.cloudshare.com/api/v3" },
    tokenProvider: { getToken: async () => "test-bearer" },
    v3: { apiId: "api-id", apiKey: "api-key" },
    newToken: () => "tokfixed01",
    now: () => 1_700_000_000_000,
  }));
}

function documentedParticipant(overrides: Record<string, unknown> = {}) {
  return {
    id: "participant-1", firstName: "Casey", lastName: "Example", email: "casey@example.test",
    invitationStatus: "notSent", invitedBy: null, participationStatus: "pending", firstJoined: null,
    envStatus: "Ready", envId: null, ...overrides,
  };
}

describe("CloudShare Sales Delivery", () => {
  it("uses only documented participant registration, reconciliation, and explicit native-invite contracts", async () => {
    const participant = { id: "participant-1", firstName: "Casey", lastName: "Example", email: "casey@example.test", invitationStatus: "notSent", invitedBy: null, participationStatus: "pending", firstJoined: null, envStatus: "Ready", envId: "server-only-environment-1" };
    const requestV4Detailed = vi.fn()
      .mockResolvedValueOnce({ data: undefined, request: { method: "POST", path: "/sales/sales-1/participants", body: [] }, response: { status: 201, body: "" } })
      .mockResolvedValueOnce({ data: { participants: [participant] }, request: { method: "GET", path: "/sales/sales-1/participants" }, response: { status: 200, body: { participants: [participant] } } })
      .mockResolvedValueOnce({ data: undefined, request: { method: "POST", path: "/sales/sales-1/participants/invite", body: ["participant-1"] }, response: { status: 200 } });
    const delivery = createCloudShareSalesDelivery({ requestV4Detailed } as never);
    await expect(delivery.registerParticipants("sales-1", [{ firstName: "Casey", lastName: "Example", email: "casey@example.test" }])).resolves.toMatchObject({ response: { status: 201, body: "" } });
    await expect(delivery.listParticipants("sales-1")).resolves.toMatchObject({ participants: [expect.objectContaining({ participationStatus: "pending", envStatus: "Ready", environmentId: "server-only-environment-1" })] });
    await delivery.inviteParticipants("sales-1", ["participant-1"]);
    expect(requestV4Detailed).toHaveBeenNthCalledWith(1, expect.objectContaining({ method: "POST", path: "/sales/sales-1/participants", body: [{ firstName: "Casey", lastName: "Example", email: "casey@example.test" }] }));
    expect(requestV4Detailed).toHaveBeenNthCalledWith(2, expect.objectContaining({ method: "GET", path: "/sales/sales-1/participants" }));
    expect(requestV4Detailed).toHaveBeenNthCalledWith(3, expect.objectContaining({ method: "POST", path: "/sales/sales-1/participants/invite", body: ["participant-1"] }));
  });
  it("marks the documented native-invite response as deliberately empty", async () => {
    const requestV4Detailed = vi.fn().mockImplementation(async (spec) => ({
      data: spec.schema.parse(undefined),
      request: { method: "POST", path: "/sales/sales-1/participants/invite", body: ["participant-1"] },
      response: { status: 200, body: "" },
    }));
    const delivery = createCloudShareSalesDelivery({ requestV4Detailed } as never);

    await expect(delivery.inviteParticipants("sales-1", ["participant-1"])).resolves.toMatchObject({
      response: { status: 200, body: "" },
    });
    expect(requestV4Detailed).toHaveBeenCalledWith(expect.objectContaining({
      method: "POST",
      path: "/sales/sales-1/participants/invite",
      allowEmptyResponse: true,
    }));
  });
  it("accepts the live count/items participant-list envelope without exposing a participant URL", async () => {
    const participant = documentedParticipant({ invitationStatus: "sent", participationStatus: "inProgress", firstJoined: "2026-07-17T09:05:00Z", envId: "server-only-environment-1", accessLink: "https://bearer.example.test/invite" });
    const liveEnvelope = { count: 1, items: [participant] };
    const requestV4Detailed = vi.fn().mockImplementation(async (spec) => ({
      data: spec.schema.parse(liveEnvelope),
      request: { method: "GET", path: "/sales/sales-1/participants" },
      response: { status: 200, body: liveEnvelope },
    }));
    const delivery = createCloudShareSalesDelivery({ requestV4Detailed } as never);

    const result = await delivery.listParticipants("sales-1");
    expect(result).toMatchObject({
      participants: [expect.objectContaining({ id: "participant-1", environmentId: "server-only-environment-1" })],
    });
    expect(JSON.stringify(result.participants)).not.toContain("https://bearer.example.test/invite");
    expect(JSON.stringify(result.participants)).not.toContain("accessLink");
  });
  it("retains an undocumented PascalCase Sales roster as full, safely-redacted evidence", async () => {
    const rawRoster = { Count: 1, Items: [{ Id: "participant-1", FirstName: "Casey", LastName: "Example", Email: "casey@example.test", InvitationStatus: "sent", ParticipationStatus: "inProgress", FirstJoined: "2026-07-17T09:05:00Z", EnvironmentId: "server-only-environment-1", EnvironmentStatus: "Ready", accessLink: "https://bearer.example.test/should-not-leak" }] };
    const delivery = deliveryForRoster(rawRoster);

    const error = await delivery.listParticipants("sales-1").catch((failure) => failure);
    expect(error).toMatchObject({ name: "CloudShareResponseError", context: { responseBody: { Count: 1, Items: [expect.objectContaining({ Email: "casey@example.test", accessLink: "[REDACTED]" })] } } });
    expect(JSON.stringify((error as { context?: unknown }).context)).toContain("casey@example.test");
    expect(JSON.stringify((error as { context?: unknown }).context)).not.toContain("bearer.example.test");
  });
  it("rejects an unrecognized participant-list envelope instead of treating it as an empty roster", async () => {
    const participant = { id: "participant-1", firstName: "Casey", lastName: "Example", email: "casey@example.test", invitationStatus: "notSent", invitedBy: null, participationStatus: "pending", firstJoined: null };
    const unrecognizedEnvelope = { count: 1, data: [participant] };
    const requestV4Detailed = vi.fn().mockImplementation(async (spec) => ({
      data: spec.schema.parse(unrecognizedEnvelope),
      request: { method: "GET", path: "/sales/sales-1/participants" },
      response: { status: 200, body: unrecognizedEnvelope },
    }));

    await expect(createCloudShareSalesDelivery({ requestV4Detailed } as never).listParticipants("sales-1")).rejects.toThrow();
  });
  it.each(["id", "firstName", "lastName", "email", "invitationStatus", "invitedBy", "participationStatus", "firstJoined", "envStatus", "envId"])("retains a roster row missing required %s as full evidence", async (field) => {
    const participant = Object.fromEntries(Object.entries(documentedParticipant()).filter(([key]) => key !== field));

    const error = await deliveryForRoster({ count: 1, items: [participant] }).listParticipants("sales-1").catch((failure) => failure);

    expect(error).toMatchObject({
      name: "CloudShareResponseError",
      context: {
        method: "GET",
        path: "/v4/sales/sales-1/participants",
        responseBody: { count: 1, items: [participant] },
      },
    });
    if (field !== "email") {
      expect(JSON.stringify((error as { context?: unknown }).context)).toContain("casey@example.test");
    }
  });
  it.each([
    ["invitationStatus", "queued"],
    ["participationStatus", "joining"],
    ["envStatus", "Running"],
  ])("rejects unsupported %s values instead of inventing a safe-looking default", async (field, value) => {
    const participant = documentedParticipant({ [field]: value });
    const envelope = { count: 1, items: [participant] };
    const requestV4Detailed = vi.fn().mockImplementation(async (spec) => ({
      data: spec.schema.parse(envelope),
      request: { method: "GET", path: "/sales/sales-1/participants" },
      response: { status: 200, body: envelope },
    }));

    await expect(createCloudShareSalesDelivery({ requestV4Detailed } as never).listParticipants("sales-1")).rejects.toThrow();
  });
  it("reads every documented participant page and fails closed when count contradicts the pages", async () => {
    const first = documentedParticipant();
    const second = documentedParticipant({ id: "participant-2", firstName: "Sam", email: "sam@example.test" });
    const requestV4Detailed = vi.fn()
      .mockResolvedValueOnce({ data: { count: 2, items: [first] }, request: { method: "GET", path: "/sales/sales-1/participants", query: { offset: "0", limit: "100" } }, response: { status: 200, body: { count: 2, items: [first] } } })
      .mockResolvedValueOnce({ data: { count: 2, items: [second] }, request: { method: "GET", path: "/sales/sales-1/participants", query: { offset: "1", limit: "100" } }, response: { status: 200, body: { count: 2, items: [second] } } });
    const delivery = createCloudShareSalesDelivery({ requestV4Detailed } as never);

    await expect(delivery.listParticipants("sales-1")).resolves.toMatchObject({ participants: [expect.objectContaining({ id: "participant-1" }), expect.objectContaining({ id: "participant-2" })] });
    expect(requestV4Detailed).toHaveBeenNthCalledWith(1, expect.objectContaining({ query: { offset: "0", limit: "100" } }));
    expect(requestV4Detailed).toHaveBeenNthCalledWith(2, expect.objectContaining({ query: { offset: "1", limit: "100" } }));

    const contradictory = createCloudShareSalesDelivery({ requestV4Detailed: vi.fn().mockResolvedValue({ data: { count: 0, items: [first] }, request: { method: "GET", path: "/sales/sales-1/participants" }, response: { status: 200, body: { count: 0, items: [first] } } }) } as never);
    await expect(contradictory.listParticipants("sales-1")).rejects.toThrow("participant page count");
  });
  it("fails closed when a single documented participant page repeats an ID", async () => {
    const repeated = documentedParticipant();
    const delivery = createCloudShareSalesDelivery({ requestV4Detailed: vi.fn().mockResolvedValue({ data: { count: 2, items: [repeated, repeated] }, request: { method: "GET", path: "/sales/sales-1/participants", query: { offset: "0", limit: "100" } }, response: { status: 200, body: { count: 2, items: [repeated, repeated] } } }) } as never);

    const error = await delivery.listParticipants("sales-1").catch((failure) => failure);
    expect(error).toMatchObject({ name: "CloudShareResponseError", context: { status: 200, requestQuery: { offset: "0", limit: "100" }, responseBody: { count: 2, items: [repeated, repeated] }, expectedCount: 2, returnedCount: 2, failureMode: "participant_page_duplicate_id" } });
    expect(JSON.stringify((error as { context?: unknown }).context)).toContain("casey@example.test");
  });
  it("paginates the documented count/participants envelope", async () => {
    const first = documentedParticipant();
    const second = documentedParticipant({ id: "participant-2", firstName: "Sam", email: "sam@example.test" });
    const requestV4Detailed = vi.fn()
      .mockResolvedValueOnce({ data: { count: 2, participants: [first] }, request: { method: "GET", path: "/sales/sales-1/participants", query: { offset: "0", limit: "100" } }, response: { status: 200, body: { count: 2, participants: [first] } } })
      .mockResolvedValueOnce({ data: { count: 2, participants: [second] }, request: { method: "GET", path: "/sales/sales-1/participants", query: { offset: "1", limit: "100" } }, response: { status: 200, body: { count: 2, participants: [second] } } });

    await expect(createCloudShareSalesDelivery({ requestV4Detailed } as never).listParticipants("sales-1")).resolves.toMatchObject({ participants: [expect.objectContaining({ id: "participant-1" }), expect.objectContaining({ id: "participant-2" })] });
    expect(requestV4Detailed).toHaveBeenCalledTimes(2);
  });
  it("uses documented v4 GET /sales/{id} only for reconciliation", async () => {
    const requestV4 = vi.fn().mockResolvedValue({ id: "sales-1", status: "active" });
    const delivery = createCloudShareSalesDelivery({ requestV4, requestV3: vi.fn(), requestV3Text: vi.fn() });
    await expect(delivery.readSession("sales-1")).resolves.toMatchObject({ id: "sales-1", status: "active" });
    expect(requestV4).toHaveBeenCalledWith(expect.objectContaining({ method: "GET", path: "/sales/sales-1" }));
  });
  it("reads the documented full model before sending a full PUT /sales/{id} that keeps invitations suppressed", async () => {
    const full = { id: "sales-1", accessLink: "bearer-secret", name: "Original", type: "demo", projectId: "project-1", teamId: "team-1", blueprintIds: ["bp-1"], allowParticipantsSwitchSteps: null, cloudshareRegionIds: ["region-1"], awsCloudRegion: null, azureCloudRegion: null, googleCloudProviderRegion: null, googleCloudProviderZone: null, policyId: "policy-1", opportunity: "Acme", externalId: "portal-correlation", mainSalesPro: { email: "sales@certalis.demo" }, additionalSalesPros: null, registrationType: "registeredParticipantsOnly", passphrase: "server-only", description: null, labels: null, allowMultipleEnvironmentActivations: false, sendInvitations: "dontSend", emailDomainBlocklist: null, blockFreeEmailDomains: false, customFields: null, useCustomInvitationEmail: false, preConfigureParticipantEnvironments: null, sharedEnvBlueprintId: null, sharedEnvPolicyId: null, isSharedLabViewAccessEnabled: null, allowAudioVideo: false, start: "2026-07-15T09:00", end: "2026-07-15T10:00", timeZone: "UTC" };
    const requestV4Detailed = vi.fn().mockResolvedValueOnce({ data: full, request: { method: "GET", path: "/sales/sales-1" }, response: { status: 200, body: full } }).mockResolvedValueOnce({ data: { ...full, name: "Renamed" }, request: { method: "PUT", path: "/sales/sales-1", body: { ...full, name: "Renamed" } }, response: { status: 200, body: { ...full, name: "Renamed" } } });
    const delivery = createCloudShareSalesDelivery({ requestV4Detailed } as never);
    await expect(delivery.updateSession!("sales-1", { name: "Renamed" })).resolves.toMatchObject({ id: "sales-1", request: { method: "PUT" } });
    expect(requestV4Detailed).toHaveBeenLastCalledWith(expect.objectContaining({ method: "PUT", path: "/sales/sales-1", body: expect.objectContaining({ name: "Renamed", projectId: "project-1", blueprintIds: ["bp-1"], mainSalesPro: { email: "sales@certalis.demo" }, externalId: "portal-correlation", registrationType: "registeredParticipantsOnly", sendInvitations: "dontSend" }) }));
    expect(requestV4Detailed.mock.calls[1][0].body).not.toHaveProperty("accessLink");
  });
  it("fails closed without PUT when GET cannot preserve every documented mutable Sales field", async () => {
    const incomplete = { id: "sales-1", name: "Original", type: "demo", projectId: "project-1", blueprintIds: ["bp-1"], cloudshareRegionIds: ["region-1"], policyId: "policy-1", opportunity: "Acme", mainSalesPro: { email: "sales@certalis.demo" }, registrationType: "registeredParticipantsOnly", start: "2026-07-15T09:00", end: "2026-07-15T10:00", timeZone: "UTC" };
    const requestV4Detailed = vi.fn().mockResolvedValue({ data: incomplete, request: { method: "GET", path: "/sales/sales-1" }, response: { status: 200, body: incomplete } });
    const delivery = createCloudShareSalesDelivery({ requestV4Detailed } as never);

    await expect(delivery.updateSession!("sales-1", { name: "Renamed" })).rejects.toThrow("complete documented Sales Experience");
    expect(requestV4Detailed).toHaveBeenCalledTimes(1);
  });
  it("uses the documented direct v4 Sales Experience contract with registered admission and no invitations", async () => {
    const requestV4Detailed = vi.fn()
      .mockResolvedValueOnce({ data: { id: "sales-1" }, request: { method: "POST", path: "/sales", query: { trace: "safe" }, headers: { "x-request-id": "req-1" }, body: {} }, response: { status: 201, headers: { "x-correlation-id": "cloud-1" }, body: { id: "sales-1" }, network: { remoteAddress: "203.0.113.1", transport: "tcp" }, tls: { protocol: "TLSv1.3", authorized: true } } });
    const delivery = createCloudShareSalesDelivery({ requestV4Detailed } as never);
    const result = await delivery.createSession({ name: "Acme Demo", type: "demo", projectId: "project-1", blueprintIds: ["bp-1"], regionIds: ["region-1"], policyId: "policy-1", opportunity: "Acme evaluation", externalId: "a3d9df53a55e4c748c3acb4dd89ae51c", passphrase: "k9X3pL8vQ2mR7sT4wY6zA1bC5dE0fG", start: "2026-07-15T09:00", end: "2026-07-16T09:00", timeZone: "UTC", mainSalesProEmail: "sales-admin@certalis.demo", registrationType: "registeredParticipantsOnly", sendInvitations: "dontSend" });
    expect(result.salesExperienceId).toBe("sales-1");
    expect(result).toMatchObject({ request: { query: { trace: "safe" }, headers: { "x-request-id": "req-1" } }, response: { headers: { "x-correlation-id": "cloud-1" }, network: { remoteAddress: "203.0.113.1" }, tls: { protocol: "TLSv1.3" } } });
    expect(requestV4Detailed).toHaveBeenCalledWith(expect.objectContaining({ method: "POST", path: "/sales", body: expect.objectContaining({ opportunity: "Acme evaluation", externalId: "a3d9df53a55e4c748c3acb4dd89ae51c", passphrase: "k9X3pL8vQ2mR7sT4wY6zA1bC5dE0fG", registrationType: "registeredParticipantsOnly", sendInvitations: "dontSend", mainSalesPro: { email: "sales-admin@certalis.demo" } }) }));
  });
  it("accepts the nullable main Sales Pro team identifier returned by the live v4 Sales API", async () => {
    const liveResponse = { id: "sales-1", mainSalesPro: { email: "sales-admin@certalis.demo", teamId: null } };
    const requestV4Detailed = vi.fn().mockImplementation(async (spec) => ({ data: spec.schema.parse(liveResponse), request: { method: "POST", path: "/sales", body: {} }, response: { status: 201, body: liveResponse } }));
    const delivery = createCloudShareSalesDelivery({ requestV4Detailed } as never);

    await expect(delivery.createSession({ name: "Acme Demo", type: "demo", projectId: "project-1", blueprintIds: ["bp-1"], regionIds: ["region-1"], policyId: "policy-1", opportunity: "Acme evaluation", externalId: "a3d9df53a55e4c748c3acb4dd89ae51c", passphrase: "k9X3pL8vQ2mR7sT4wY6zA1bC5dE0fG", start: "2026-07-15T09:00", end: "2026-07-16T09:00", timeZone: "UTC", mainSalesProEmail: "sales-admin@certalis.demo", registrationType: "registeredParticipantsOnly", sendInvitations: "dontSend" })).resolves.toMatchObject({ salesExperienceId: "sales-1" });
  });
});
