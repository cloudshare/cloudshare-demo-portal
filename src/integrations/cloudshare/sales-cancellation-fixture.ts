import type { HttpRequest, HttpResponse } from "./http";

/** Exact synthetic resources, reachable only through the fixture transport.
 * State deliberately survives per-Customer client creation; restart resets QA.
 * Failure scenarios simulate uncertainty and are not evidence of live semantics.
 */
export function createSalesCancellationFixture(): (request: HttpRequest) => Promise<HttpResponse | null> {
  const scenarios = ["fixture", "active", "ambiguous", "retry"].map(kind => ({
    kind, id: `qa351-${kind}-sales-experience`, email: kind === "fixture" ? "qa351-participant@certalis.invalid" : `qa351-${kind}@certalis.invalid`,
    environmentId: `qa351-${kind}-environment`, archived: false, reads: 0, failedRead: false,
    end: "2026-09-20T12:00", labels: ["qa351-synthetic"],
  }));
  const response = (body: unknown, status = 200): HttpResponse => ({ status, body: JSON.stringify(body) });
  return async request => {
    const url = new URL(request.url);
    const sale = scenarios.find(s => url.pathname === `/v4/sales/${s.id}` || url.pathname === `/v4/sales/${s.id}/participants`);
    if (sale) {
      if (request.method === "GET" && url.pathname.endsWith("/participants")) return response({ count: 1, participants: [{ id: `qa351-${sale.kind}-provider-participant`, firstName: "Fixture", lastName: "Participant", email: sale.email, invitationStatus: "notSent", invitedBy: null, participationStatus: sale.kind === "fixture" ? "pending" : "inProgress", firstJoined: sale.kind === "fixture" ? null : "2026-09-19T12:01:00Z", envStatus: sale.kind === "fixture" ? null : sale.archived ? "Archived" : "Ready", envId: sale.kind === "fixture" ? null : "12345", customProperties: [{ name: "certalisSalesParticipantId", value: `qa351-${sale.kind}-participant` }, { name: "certalisOpportunityContactId", value: `qa351-${sale.kind}-contact` }] }] });
      if (request.method === "PUT") {
        const body = JSON.parse(request.body ?? "{}");
        if (typeof body.end !== "string" || !Array.isArray(body.labels)) return response({ error: "Invalid synthetic update" }, 400);
        sale.end = body.end; sale.labels = body.labels;
        return response({ id: sale.id });
      }
      if (request.method === "GET") return response({ id: sale.id, name: "Synthetic cancellation QA", status: sale.labels.includes("certalis:cancelled") ? "ended" : "inProgress", type: "demo", projectId: "p-demo-1", blueprintIds: ["qa351-blueprint"], cloudshareRegionIds: ["qa351-region"], policyId: "qa351-policy", opportunity: "Synthetic QA", mainSalesPro: { email: "qa351-owner@certalis.invalid" }, registrationType: "registeredParticipantsOnly", sendInvitations: "dontSend", start: "2026-09-19T12:00", end: sale.end, timeZone: "UTC", labels: sale.labels });
    }
    if (request.method === "GET" && url.pathname === "/api/v3/envs") {
      const target = scenarios.find(s => s.email === url.searchParams.get("ownerEmail"));
      if (!target) return null;
      target.reads++;
      if (target.kind === "retry" && target.reads === 2) return response({ error: "Synthetic pre-dispatch read failure" }, 503);
      return response(target.kind === "fixture" ? [] : [{ id: target.environmentId, projectId: "p-demo-1" }]);
    }
    const target = scenarios.find(s => s.kind !== "fixture" && s.environmentId === url.searchParams.get("envId"));
    if (!target) return null;
    if (request.method === "PUT" && url.pathname === "/api/v3/envs/actions/archive") {
      target.archived = true;
      return response({}, target.kind === "ambiguous" ? 503 : 200);
    }
    if (request.method === "GET" && url.pathname === "/api/v3/envs/actions/getextended") {
      if (target.kind === "ambiguous" && target.archived && !target.failedRead) { target.failedRead = true; return response({ error: "Synthetic post-dispatch read failure" }, 503); }
      return response({ statusCode: target.archived ? 4 : 2, expirationTime: "2026-09-20T12:00:00Z" });
    }
    return null;
  };
}
export const salesCancellationFixture = createSalesCancellationFixture();
