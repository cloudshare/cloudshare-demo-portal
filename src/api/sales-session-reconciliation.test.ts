import { describe, expect, it, vi } from "vitest";
import { handleReconcileSalesSession } from "./sales-session-reconciliation";

const actor = { type: "admin" as const, id: "a", email: "a@certalis.demo" };
const request = { customerId: "certalis", sessionId: "s1", actor };
const activeSession = { id: "s1", operationalStatus: "active" as const, cloudShareSalesExperienceId: "remote-1" };
const connection = { findByCustomerId: vi.fn().mockResolvedValue({ customerId: "certalis" }) };

describe("Sales Session reconciliation", () => {
  it("reads the persisted correlation and records protected exchange evidence", async () => {
    const updateOperationalState = vi.fn(); const diagnostics = { record: vi.fn() }; const audit = { write: vi.fn() };
    const result = await handleReconcileSalesSession({ sessions: { findById: vi.fn().mockResolvedValue(activeSession), updateOperationalState }, connections: connection, deliveryFactory: { forConnection: () => ({ readSession: vi.fn().mockResolvedValue({ id: "remote-1", status: "inProgress", request: { method: "GET", path: "/sales/remote-1" }, response: { status: 200 } }) }) }, diagnostics, audit }, request);
    expect(result).toMatchObject({ status: 200, body: { operationalStatus: "active", correlationId: expect.any(String) } });
    expect(updateOperationalState).toHaveBeenCalledWith("certalis", "s1", expect.objectContaining({ operationalStatus: "active", experienceStatus: "inProgress" }));
    expect(diagnostics.record).toHaveBeenCalledWith(expect.objectContaining({ outcome: "success", request: { method: "GET", path: "/sales/remote-1" }, response: { status: 200 } }));
    expect(audit.write).toHaveBeenCalledWith(expect.objectContaining({ outcome: "success" }));
  });

  it("fails closed and moves the operation to needs-attention for an invalid injected status", async () => {
    const updateOperationalState = vi.fn(); const diagnostics = { record: vi.fn() };
    const result = await handleReconcileSalesSession({ sessions: { findById: vi.fn().mockResolvedValue(activeSession), updateOperationalState }, connections: connection, deliveryFactory: { forConnection: () => ({ readSession: vi.fn().mockResolvedValue({ id: "remote-1", status: "active", request: { method: "GET", path: "/sales/remote-1" }, response: { status: 200, body: { id: "remote-1", status: "active" } } }) } as never) }, diagnostics }, request);
    expect(result.status).toBe(502);
    expect(updateOperationalState).not.toHaveBeenCalledWith("certalis", "s1", expect.objectContaining({ operationalStatus: "active" }));
    expect(updateOperationalState).toHaveBeenCalledWith("certalis", "s1", expect.objectContaining({ operationalStatus: "needs_attention" }));
    expect(diagnostics.record).toHaveBeenCalledWith(expect.objectContaining({ outcome: "failure", details: expect.objectContaining({ failureMode: "sales_status_contract" }) }));
  });

  it("marks a failed CloudShare read needs-attention and records failure evidence", async () => {
    const updateOperationalState = vi.fn(); const diagnostics = { record: vi.fn() }; const audit = { write: vi.fn() };
    const result = await handleReconcileSalesSession({ sessions: { findById: vi.fn().mockResolvedValue(activeSession), updateOperationalState }, connections: connection, deliveryFactory: { forConnection: () => ({ readSession: vi.fn().mockRejectedValue(Object.assign(new Error("offline"), { context: { method: "GET", path: "/sales/remote-1", requestBody: { marker: "request-marker" }, responseStatus: 503, responseBody: { marker: "response-marker" } } })) }) }, diagnostics, audit }, request);
    expect(result).toMatchObject({ status: 502, body: { correlationId: expect.any(String) } });
    expect(updateOperationalState).toHaveBeenCalledWith("certalis", "s1", expect.objectContaining({ operationalStatus: "needs_attention" }));
    expect(diagnostics.record).toHaveBeenCalledWith(expect.objectContaining({ outcome: "failure", request: expect.objectContaining({ path: "/sales/remote-1", body: { marker: "request-marker" } }), response: expect.objectContaining({ status: 503, body: { marker: "response-marker" } }) }));
  });

  it("keeps OAuth token failure evidence metadata-only during reconciliation", async () => {
    const updateOperationalState = vi.fn(); const diagnostics = { record: vi.fn() };
    const oauthFailure = Object.assign(new Error("wrapped OAuth token exchange returned 503"), { context: {
      method: "POST",
      path: "/oauth/token",
      integrationSurface: "cloudshare.v4.oauth.token",
      failureMode: "http_failure",
      status: 503,
      requestBody: { client_id: "private-client", client_secret: "private-secret" },
      responseBody: { access_token: "private-token" },
    } });
    const result = await handleReconcileSalesSession({
      sessions: { findById: vi.fn().mockResolvedValue(activeSession), updateOperationalState },
      connections: connection,
      deliveryFactory: { forConnection: () => ({ readSession: vi.fn().mockRejectedValue(oauthFailure) }) },
      diagnostics,
    }, request);
    const failure = diagnostics.record.mock.calls
      .map(([entry]) => entry)
      .find((entry) => entry.operation === "sales.demo_session.reconciled" && entry.outcome === "failure");

    expect(result).toMatchObject({ status: 502, body: { correlationId: expect.any(String) } });
    expect(failure).toMatchObject({ request: null, response: null, details: expect.objectContaining({ failureMode: "http_failure" }) });
    const persisted = JSON.stringify(failure);
    expect(persisted).not.toContain("private-client");
    expect(persisted).not.toContain("private-secret");
    expect(persisted).not.toContain("private-token");
  });

  it("returns correlated failure diagnostics when local observation persistence is unavailable", async () => {
    const updateOperationalState = vi.fn().mockRejectedValue(new Error("database unavailable")); const diagnostics = { record: vi.fn() }; const audit = { write: vi.fn() };
    const result = await handleReconcileSalesSession({ sessions: { findById: vi.fn().mockResolvedValue(activeSession), updateOperationalState }, connections: connection, deliveryFactory: { forConnection: () => ({ readSession: vi.fn().mockResolvedValue({ id: "remote-1", status: "notStarted", request: { method: "GET", path: "/sales/remote-1" }, response: { status: 200 } }) }) }, diagnostics, audit }, request);
    expect(result.status).toBe(502);
    expect(diagnostics.record).toHaveBeenCalledWith(expect.objectContaining({ outcome: "failure", details: expect.objectContaining({ failureMode: "local_reconciliation_persistence" }) }));
  });

  it.each([
    { operationalStatus: "provisioning", cloudShareSalesExperienceId: "pending:session-uuid" },
    { operationalStatus: "active", cloudShareSalesExperienceId: "unprovisioned" },
    { operationalStatus: "active", cloudShareSalesExperienceId: "pending:session-uuid" },
  ])("rejects an ineligible correlation before constructing a delivery", async (session) => {
    const forConnection = vi.fn();
    const result = await handleReconcileSalesSession({ sessions: { findById: vi.fn().mockResolvedValue({ id: "s1", ...session }), updateOperationalState: vi.fn() }, connections: connection, deliveryFactory: { forConnection } }, request);
    expect(result.status).toBe(409); expect(forConnection).not.toHaveBeenCalled();
  });
});
