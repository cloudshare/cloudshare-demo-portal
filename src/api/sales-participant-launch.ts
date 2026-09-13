import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { AuditRepository } from "@/domain/audit-trail";
import type { DiagnosticRecorder } from "@/domain/diagnostic-log";
import type { SalesParticipantLaunchLinkRepository } from "@/domain/sales-participant-launch-link";
import type { SalesDemoSession, SalesDemoSessionRepository } from "@/domain/sales-demo-session";
import type { SalesSessionParticipantRepository } from "@/domain/sales-session-participant";
import type { SalesRecordRepository } from "@/domain/sales-records";
import type { CloudShareConnectionRepository, CloudShareClientFactory } from "@/domain/cloudshare-connection";
import { createCloudShareSalesDelivery, type SalesDelivery } from "@/integrations/cloudshare/sales-delivery";
import { projectCloudShareFailureContext, projectCloudShareFailureEvidence } from "@/integrations/cloudshare/diagnostic-failure-projection";
import { cloudShareWallClockToInstant } from "@/domain/cloudshare-wall-clock";
import { createSalesLaunchDenialContextResolver, type SalesLaunchDenialContext, type SalesLaunchDenialContextResolver } from "./sales-launch-denial-context";

type Actor = { readonly type: string; readonly id: string; readonly email: string };
type AdminRequest = { readonly customerId: string; readonly sessionId: string; readonly participantId: string; readonly actor: Actor };
type Deps = { sessions: { findById(customerId: string, id: string): Promise<SalesDemoSession | null> }; participants: SalesSessionParticipantRepository; records: Pick<SalesRecordRepository, "findContact">; links: SalesParticipantLaunchLinkRepository; connections: Pick<CloudShareConnectionRepository, "findByCustomerId">; cloudshare: Pick<CloudShareClientFactory, "forConnection">; deliveryFactory?: { forConnection(connection: NonNullable<Awaited<ReturnType<CloudShareConnectionRepository["findByCustomerId"]>>>): Pick<SalesDelivery, "createSponsoredLink" | "listSalesPros"> }; denialContextResolver?: SalesLaunchDenialContextResolver; diagnostics?: DiagnosticRecorder; audit?: Pick<AuditRepository, "write">; now?: () => Date };
const hash = (token: string) => createHash("sha256").update(token).digest("hex");
const generic = { status: 404, body: { error: "This Certalis launch link is unavailable." } } as const;

export async function handleCreateSalesParticipantLaunchLink(deps: Deps, request: AdminRequest): Promise<{ status: number; body: Record<string, string> }> {
  const owned = await ownedParticipant(deps, request); if (!owned) return generic;
  const now = (deps.now ?? (() => new Date()))(); const end = cloudShareWallClockToInstant(owned.session.end, owned.session.timeZone);
  if (!end || end <= now) return adminDenied(deps, request, "sales_session_ended", "Instant launch link creation is unavailable after this Sales Session has ended.");
  if (owned.participant.participationStatus === "concluded") return adminDenied(deps, request, "sales_participant_concluded", "Instant launch links are unavailable for concluded Sales Participants.");
  const token = randomBytes(32).toString("base64url"); const correlationId = randomUUID();
  try {
    await deps.links.regenerate({ id: randomUUID(), customerId: request.customerId, salesDemoSessionId: request.sessionId, salesSessionParticipantId: owned.participant.id, tokenHash: hash(token), revokedAt: null, createdAt: now }, now, correlationId);
  } catch (error) {
    return adminPersistenceFailure(deps, request, "generated", correlationId, error);
  }
  await adminEvidence(deps, request, correlationId, "sales.demo_session.participant_launch.generated", "success");
  return { status: 201, body: { launchUrl: `/sales/launch/${token}`, correlationId } };
}
export async function handleRevokeSalesParticipantLaunchLink(deps: Deps, request: AdminRequest): Promise<{ status: number; body: Record<string, string> }> {
  if (!await ownedParticipant(deps, request)) return generic;
  const correlationId = randomUUID();
  try { await deps.links.revokeActive(request.customerId, request.sessionId, request.participantId, (deps.now ?? (() => new Date()))(), correlationId); }
  catch (error) { return adminPersistenceFailure(deps, request, "revoked", correlationId, error); }
  await adminEvidence(deps, request, correlationId, "sales.demo_session.participant_launch.revoked", "success"); return { status: 200, body: { correlationId } };
}
export async function handleSalesParticipantLaunch(deps: Deps, token: string): Promise<{ status: number; redirect?: string; body?: { error: string; correlationId?: string; denialContext?: SalesLaunchDenialContext | null } }> {
  const correlationId = randomUUID(); let link: Awaited<ReturnType<SalesParticipantLaunchLinkRepository["findByTokenHash"]>> = null;
  try { link = token.length >= 40 ? await deps.links.findByTokenHash(hash(token)) : null; } catch (error) { return launchDenied(deps, null, correlationId, "persistence_failure", error); }
  if (!link || link.revokedAt) return launchDenied(deps, link, correlationId, "unavailable");
  let session: SalesDemoSession | null; let participants: Awaited<ReturnType<SalesSessionParticipantRepository["list"]>>;
  try { session = await deps.sessions.findById(link.customerId, link.salesDemoSessionId); participants = session ? await deps.participants.list(link.customerId, session.id) : []; }
  catch (error) { return launchDenied(deps, link, correlationId, "persistence_failure", error); }
  const participant = participants.find((value) => value.id === link.salesSessionParticipantId); const now = (deps.now ?? (() => new Date()))();
  const start = session ? cloudShareWallClockToInstant(session.start, session.timeZone) : null; const end = session ? cloudShareWallClockToInstant(session.end, session.timeZone) : null;
  if (!session || !participant || !start || !end || now < start || now >= end) return launchDenied(deps, link, correlationId, "unavailable");
  let contact: Awaited<ReturnType<SalesRecordRepository["findContact"]>>; let connection: Awaited<ReturnType<CloudShareConnectionRepository["findByCustomerId"]>>;
  try { contact = await deps.records.findContact(link.customerId, participant.opportunityContactId); connection = await deps.connections.findByCustomerId(link.customerId); }
  catch (error) { return launchDenied(deps, link, correlationId, "persistence_failure", error); }
  if (!contact || !connection) return launchDenied(deps, link, correlationId, "unavailable");
  try { const delivery = deps.deliveryFactory?.forConnection(connection) ?? createCloudShareSalesDelivery(deps.cloudshare.forConnection(connection, { scope: "customer_default", reason: "unanchored_support_read" })); const sponsored = await delivery.createSponsoredLink(session.cloudShareSalesExperienceId, contact); await launchEvidence(deps, link, correlationId, "success", sponsored); return { status: 302, redirect: sponsored.loginUrl }; }
  catch (error) { return launchDenied(deps, link, correlationId, "provider_failure", error); }
}
async function ownedParticipant(deps: Deps, request: AdminRequest) { const session = await deps.sessions.findById(request.customerId, request.sessionId); if (!session) return null; const participant = (await deps.participants.list(request.customerId, request.sessionId)).find((value) => value.id === request.participantId); return participant ? { session, participant } : null; }
async function adminDenied(deps: Deps, request: AdminRequest, code: "sales_session_ended" | "sales_participant_concluded", error: string) { const correlationId = randomUUID(); await deps.diagnostics?.record({ source: "sales-participant-launch", operation: "sales.demo_session.participant_launch.generated", outcome: "failure", customerId: request.customerId, actor: request.actor, subject: { type: "sales_session_participant", id: request.participantId }, message: error, correlationId, details: { sessionId: request.sessionId, failureMode: code } }); await deps.audit?.write({ id: randomUUID(), customerId: request.customerId, actorType: request.actor.type, actorId: request.actor.id, actorEmail: request.actor.email, action: "sales.demo_session.participant_launch.generated", subjectType: "sales_session_participant", subjectId: request.participantId, outcome: "failure", correlationId, occurredAt: new Date(), error }); return { status: 409, body: { code, error, correlationId } }; }
async function adminEvidence(deps: Deps, request: AdminRequest, correlationId: string, operation: string, outcome: "success") { await deps.diagnostics?.record({ source: "sales-participant-launch", operation, outcome, customerId: request.customerId, actor: request.actor, subject: { type: "sales_session_participant", id: request.participantId }, message: "Sales participant launch capability updated.", correlationId, details: { sessionId: request.sessionId } }); await deps.audit?.write({ id: randomUUID(), customerId: request.customerId, actorType: request.actor.type, actorId: request.actor.id, actorEmail: request.actor.email, action: operation, subjectType: "sales_session_participant", subjectId: request.participantId, outcome, correlationId, occurredAt: new Date() }); }
async function adminPersistenceFailure(deps: Deps, request: AdminRequest, action: "generated" | "revoked", correlationId: string, error: unknown) {
  const operation = `sales.demo_session.participant_launch.${action}`;
  const message = `Certalis could not persist the Sales Participant launch link ${action === "generated" ? "creation" : "revocation"}.`;
  const failureMode = "persistence_failure";
  try { await deps.diagnostics?.record({ source: "sales-participant-launch", operation, outcome: "failure", customerId: request.customerId, actor: request.actor, subject: { type: "sales_session_participant", id: request.participantId }, message, correlationId, details: { sessionId: request.sessionId, failureMode, errorName: error instanceof Error ? error.name : "unknown" } }); } catch { /* best effort */ }
  try { await deps.audit?.write({ id: randomUUID(), customerId: request.customerId, actorType: request.actor.type, actorId: request.actor.id, actorEmail: request.actor.email, action: operation, subjectType: "sales_session_participant", subjectId: request.participantId, outcome: "failure", correlationId, occurredAt: new Date(), error: message }); } catch { /* best effort */ }
  return { status: 503, body: { code: "persistence_failure", error: message, correlationId } };
}
async function launchEvidence(deps: Deps, link: Awaited<ReturnType<SalesParticipantLaunchLinkRepository["findByTokenHash"]>>, correlationId: string, outcome: "success" | "failure", sponsored?: { request: unknown; response: unknown }, failure?: unknown) {
  const context = failure && typeof failure === "object" && "context" in failure ? (failure as { context?: Record<string, unknown> }).context : undefined;
  const failureEvidence = projectCloudShareFailureEvidence(failure) ?? projectCloudShareFailureContext(context);
  const oauthFailure = failureEvidence?.request === null && failureEvidence.response === null;
  const status = typeof context?.responseStatus === "number" ? context.responseStatus : typeof context?.status === "number" ? context.status : undefined;
  const protectedFailure = context ? {
    integrationSurface: typeof context.integrationSurface === "string" ? context.integrationSurface : "cloudshare.v4.sales.sponsored_link",
    failureMode: context.failureMode ?? (status === undefined ? "transport_failure" : "http_failure"),
    ...(oauthFailure ? (status === undefined ? {} : { status }) : { cause: context.cause ?? null, network: context.network ?? null, tls: context.tls ?? null }),
  } : undefined;
  const customerId = link?.customerId ?? null;
  const subjectId = link?.salesSessionParticipantId ?? null;
  await deps.diagnostics?.record({
    source: "sales-participant-launch", operation: "sales.demo_session.participant_launch.opened", outcome, customerId,
    actor: { type: "anonymous" }, subject: { type: "sales_session_participant", id: subjectId },
    message: outcome === "success" ? "Sales participant launch redirected." : "Sales participant launch blocked.", correlationId,
    ...(sponsored ? { request: sponsored.request as Record<string, unknown>, response: sponsored.response as Record<string, unknown>, details: { integrationSurface: "cloudshare.v4.sales.sponsored_link" } } : {}),
    ...(protectedFailure && failureEvidence ? { request: failureEvidence.request as Record<string, unknown> | null, response: failureEvidence.response as Record<string, unknown> | null, details: protectedFailure } : {}),
  });
  await deps.audit?.write({ id: randomUUID(), customerId, action: "sales.demo_session.participant_launch.opened", subjectType: "sales_session_participant", subjectId, outcome: outcome === "success" ? "success" : "failure", correlationId, occurredAt: new Date() });
}
async function launchDenied(deps: Deps, link: Awaited<ReturnType<SalesParticipantLaunchLinkRepository["findByTokenHash"]>>, correlationId: string, _reason: string, failure?: unknown) {
  try { await launchEvidence(deps, link, correlationId, "failure", undefined, failure); } catch { /* Denial evidence must never turn a safe 404 into a 500. */ }
  let denialContext: SalesLaunchDenialContext | null = null;
  if (link) {
    try { denialContext = await (deps.denialContextResolver ?? createSalesLaunchDenialContextResolver(deps)).resolve(link, correlationId); }
    catch (error) {
      try { await deps.diagnostics?.record({ source: "sales-participant-launch", operation: "sales.demo_session.participant_launch.denial_enrichment", outcome: "failure", customerId: link.customerId, actor: { type: "anonymous" }, subject: { type: "sales_session_participant", id: link.salesSessionParticipantId }, message: "Sales launch denial enrichment was unavailable.", correlationId, details: { integrationSurface: "certalis.sales.launch_denial_context", failureMode: error instanceof Error ? error.name : "enrichment_failure" } }); } catch { /* Best-effort protected evidence. */ }
    }
  }
  return { ...generic, body: { ...generic.body, correlationId, ...(denialContext ? { denialContext } : {}) } };
}
