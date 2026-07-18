import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { AuditRepository } from "@/domain/audit-trail";
import type { DiagnosticRecorder } from "@/domain/diagnostic-log";
import type { SalesParticipantLaunchLinkRepository } from "@/domain/sales-participant-launch-link";
import type { SalesDemoSession, SalesDemoSessionRepository } from "@/domain/sales-demo-session";
import type { SalesSessionParticipantRepository } from "@/domain/sales-session-participant";
import type { SalesRecordRepository } from "@/domain/sales-records";
import type { CloudShareConnectionRepository, CloudShareClientFactory } from "@/domain/cloudshare-connection";
import { createCloudShareSalesDelivery, type SalesDelivery } from "@/integrations/cloudshare/sales-delivery";
import { cloudShareWallClockToInstant } from "@/domain/cloudshare-wall-clock";
import { createSalesLaunchDenialContextResolver, type SalesLaunchDenialContext, type SalesLaunchDenialContextResolver } from "./sales-launch-denial-context";

type Actor = { readonly type: string; readonly id: string; readonly email: string };
type AdminRequest = { readonly customerId: string; readonly sessionId: string; readonly participantId: string; readonly actor: Actor };
type Deps = { sessions: { findById(customerId: string, id: string): Promise<SalesDemoSession | null> }; participants: SalesSessionParticipantRepository; records: Pick<SalesRecordRepository, "findContact">; links: SalesParticipantLaunchLinkRepository; connections: Pick<CloudShareConnectionRepository, "findByCustomerId">; cloudshare: Pick<CloudShareClientFactory, "forConnection">; deliveryFactory?: { forConnection(connection: NonNullable<Awaited<ReturnType<CloudShareConnectionRepository["findByCustomerId"]>>>): Pick<SalesDelivery, "createSponsoredLink" | "listSalesPros"> }; denialContextResolver?: SalesLaunchDenialContextResolver; diagnostics?: DiagnosticRecorder; audit?: Pick<AuditRepository, "write">; now?: () => Date };
const hash = (token: string) => createHash("sha256").update(token).digest("hex");
const generic = { status: 404, body: { error: "This Certalis launch link is unavailable." } } as const;

export async function handleCreateSalesParticipantLaunchLink(deps: Deps, request: AdminRequest): Promise<{ status: number; body: Record<string, string> }> {
  const participant = await ownedParticipant(deps, request); if (!participant) return generic;
  const now = (deps.now ?? (() => new Date()))(); const token = randomBytes(32).toString("base64url"); const correlationId = randomUUID();
  await deps.links.regenerate({ id: randomUUID(), customerId: request.customerId, salesDemoSessionId: request.sessionId, salesSessionParticipantId: participant.id, tokenHash: hash(token), revokedAt: null, createdAt: now }, now);
  await adminEvidence(deps, request, correlationId, "sales.demo_session.participant_launch.generated", "success");
  return { status: 201, body: { launchUrl: `/sales/launch/${token}`, correlationId } };
}
export async function handleRevokeSalesParticipantLaunchLink(deps: Deps, request: AdminRequest): Promise<{ status: number; body: Record<string, string> }> {
  if (!await ownedParticipant(deps, request)) return generic;
  const correlationId = randomUUID(); await deps.links.revokeActive(request.customerId, request.sessionId, request.participantId, (deps.now ?? (() => new Date()))());
  await adminEvidence(deps, request, correlationId, "sales.demo_session.participant_launch.revoked", "success"); return { status: 200, body: { correlationId } };
}
export async function handleSalesParticipantLaunch(deps: Deps, token: string): Promise<{ status: number; redirect?: string; body?: { error: string; correlationId?: string; denialContext?: SalesLaunchDenialContext | null } }> {
  const correlationId = randomUUID(); const link = token.length >= 40 ? await deps.links.findByTokenHash(hash(token)) : null;
  if (!link || link.revokedAt) return launchDenied(deps, link, correlationId, "unavailable");
  const session = await deps.sessions.findById(link.customerId, link.salesDemoSessionId); const participants = session ? await deps.participants.list(link.customerId, session.id) : [];
  const participant = participants.find((value) => value.id === link.salesSessionParticipantId); const now = (deps.now ?? (() => new Date()))();
  const start = session ? cloudShareWallClockToInstant(session.start, session.timeZone) : null; const end = session ? cloudShareWallClockToInstant(session.end, session.timeZone) : null;
  if (!session || !participant || !start || !end || now < start || now >= end) return launchDenied(deps, link, correlationId, "unavailable");
  const contact = await deps.records.findContact(link.customerId, participant.opportunityContactId); const connection = await deps.connections.findByCustomerId(link.customerId);
  if (!contact || !connection) return launchDenied(deps, link, correlationId, "unavailable");
  try { const delivery = deps.deliveryFactory?.forConnection(connection) ?? createCloudShareSalesDelivery(deps.cloudshare.forConnection(connection)); const sponsored = await delivery.createSponsoredLink(session.cloudShareSalesExperienceId, contact); await launchEvidence(deps, link, correlationId, "success", sponsored); return { status: 302, redirect: sponsored.loginUrl }; }
  catch (error) { return launchDenied(deps, link, correlationId, "provider_failure", error); }
}
async function ownedParticipant(deps: Deps, request: AdminRequest) { const session = await deps.sessions.findById(request.customerId, request.sessionId); if (!session) return null; return (await deps.participants.list(request.customerId, request.sessionId)).find((value) => value.id === request.participantId) ?? null; }
async function adminEvidence(deps: Deps, request: AdminRequest, correlationId: string, operation: string, outcome: "success") { await deps.diagnostics?.record({ source: "sales-participant-launch", operation, outcome, customerId: request.customerId, actor: request.actor, subject: { type: "sales_session_participant", id: request.participantId }, message: "Sales participant launch capability updated.", correlationId, details: { sessionId: request.sessionId } }); await deps.audit?.write({ id: randomUUID(), customerId: request.customerId, actorType: request.actor.type, actorId: request.actor.id, actorEmail: request.actor.email, action: operation, subjectType: "sales_session_participant", subjectId: request.participantId, outcome, correlationId, occurredAt: new Date() }); }
async function launchEvidence(deps: Deps, link: Awaited<ReturnType<SalesParticipantLaunchLinkRepository["findByTokenHash"]>>, correlationId: string, outcome: "success" | "failure", sponsored?: { request: unknown; response: unknown }, failure?: unknown) { const context = failure && typeof failure === "object" && "context" in failure ? (failure as { context?: Record<string, unknown> }).context : undefined; const customerId = link?.customerId ?? null; const subjectId = link?.salesSessionParticipantId ?? null; const protectedFailure = context ? { integrationSurface: "cloudshare.v4.sales.sponsored_link", failureMode: context.failureMode ?? (context.responseStatus ?? context.status ? "http_failure" : "transport_failure"), cause: context.cause ?? null, network: context.network ?? null, tls: context.tls ?? null } : undefined; await deps.diagnostics?.record({ source: "sales-participant-launch", operation: "sales.demo_session.participant_launch.opened", outcome, customerId, actor: { type: "anonymous" }, subject: { type: "sales_session_participant", id: subjectId }, message: outcome === "success" ? "Sales participant launch redirected." : "Sales participant launch blocked.", correlationId, ...(sponsored ? { request: sponsored.request as Record<string, unknown>, response: sponsored.response as Record<string, unknown>, details: { integrationSurface: "cloudshare.v4.sales.sponsored_link" } } : {}), ...(protectedFailure ? { request: { method: context!.method, path: context!.path, headers: context!.requestHeaders, body: context!.requestBody }, response: { status: context!.responseStatus ?? context!.status, headers: context!.responseHeaders, body: context!.responseBody, transport: context!.transport, network: context!.network, tls: context!.tls }, details: protectedFailure } : {}) }); await deps.audit?.write({ id: randomUUID(), customerId, action: "sales.demo_session.participant_launch.opened", subjectType: "sales_session_participant", subjectId, outcome: outcome === "success" ? "success" : "failure", correlationId, occurredAt: new Date() }); }
async function launchDenied(deps: Deps, link: Awaited<ReturnType<SalesParticipantLaunchLinkRepository["findByTokenHash"]>>, correlationId: string, _reason: string, failure?: unknown) { await launchEvidence(deps, link, correlationId, "failure", undefined, failure); const denialContext = link ? await (deps.denialContextResolver ?? createSalesLaunchDenialContextResolver(deps)).resolve(link, correlationId) : null; return { ...generic, body: { ...generic.body, correlationId, ...(denialContext ? { denialContext } : {}) } }; }
