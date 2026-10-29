import { createHash, randomUUID } from "node:crypto";
import type { SalesTrialOfferingRepository } from "@/domain/sales-trial-offering";
import { hasContinuableSalesTrialEnvironment, type SalesTrialEnrollmentRepository } from "@/domain/sales-trial-enrollment";
import type { ItemRepository } from "@/domain/item";
import type { CloudShareClientFactory, CloudShareConnectionRepository } from "@/domain/cloudshare-connection";
import type { DiagnosticRecorder } from "@/domain/diagnostic-log";
import type { AuditRepository } from "@/domain/audit-trail";
import { createCloudShareSalesDelivery, requireCompleteSalesParticipantRoster } from "@/integrations/cloudshare/sales-delivery";
import { createCloudShareSalesEnvironmentModule } from "@/integrations/cloudshare/environment-observation";
import { createCloudShareTrialRdp, trialRdpVmAvailability } from "@/integrations/cloudshare/trial-rdp";
import { createSalesTrialCloudShareObserver } from "./sales-trial-cloudshare-diagnostics";
import { hasRequiredEnrollmentCorrelation, isOfferingOpen, isLaunchableProviderSession } from "./sales-trial-enrollment";
export interface SalesTrialRdpRequest { customerId: string; userId: string; email: string; offeringId: string; selector?: string }
export interface SalesTrialRdpDeps {
 offerings: Pick<SalesTrialOfferingRepository, "findById">;
 enrollments: Pick<SalesTrialEnrollmentRepository, "findByOfferingAndPortalUser">;
 items: Pick<ItemRepository, "findById">;
 connections: Pick<CloudShareConnectionRepository, "findByCustomerId">;
 cloudshare: Pick<CloudShareClientFactory, "forConnection">;
 diagnostics?: DiagnosticRecorder;
 audit?: Pick<AuditRepository, "write">;
 now?: () => Date;
}
export interface TrialRdpStatus {
 state: "ready" | "preparing" | "unavailable";
 message?: string;
 machines?: { selector: string; name: string; state: "ready" | "preparing" | "unavailable" }[];
}
export interface TrialRdpResult { status: number; body?: TrialRdpStatus; file?: string }
const unavailable = (status = 409): TrialRdpResult => ({ status, body: { state: "unavailable", message: "Remote desktop is unavailable for this Trial. You can still use the trial window." } });
export async function handleSalesTrialRdp(deps: SalesTrialRdpDeps, request: SalesTrialRdpRequest): Promise<TrialRdpResult> {
 const correlationId = randomUUID();
 const now = (deps.now ?? (() => new Date()))();
 try {
  const offering = await deps.offerings.findById(request.customerId, request.offeringId);
  if (!offering || offering.customerId !== request.customerId) return unavailable(404);
  const enrollment = await deps.enrollments.findByOfferingAndPortalUser(request.customerId, offering.id, request.userId);
  if (!enrollment || enrollment.customerId !== request.customerId || enrollment.portalUserId !== request.userId || enrollment.salesTrialOfferingId !== offering.id || enrollment.status !== "active" || !enrollment.lastLaunchedAt || !enrollment.cloudShareParticipantId) return unavailable(404);
  const continued = (offering.status === "unpublished" || offering.status === "ending") && hasContinuableSalesTrialEnvironment(enrollment);
  if (!offering.cloudShareSalesExperienceId || !(continued || (offering.status === "published" && isOfferingOpen(offering.start, offering.end, offering.timeZone, now)))) return unavailable();
  const item = await deps.items.findById(offering.itemId);
  const connection = await deps.connections.findByCustomerId(request.customerId);
  if (!item || item.customerId !== request.customerId || !connection || connection.customerId !== request.customerId) return unavailable();
  const actor = { type: "sales_trial_participant" as const, id: request.userId, email: request.email };
  const observer = createSalesTrialCloudShareObserver({ diagnostics: deps.diagnostics, customerId: request.customerId, actor, correlationId, source: "sales-trial-rdp", subject: { type: "sales_trial_enrollment", id: enrollment.id }, candidateEmail: request.email });
  const client = deps.cloudshare.forConnection(connection, observer);
  const delivery = createCloudShareSalesDelivery(client);
  if (!isLaunchableProviderSession(offering, await delivery.readSession(offering.cloudShareSalesExperienceId), continued)) return unavailable();
  const roster = await delivery.listParticipants(offering.cloudShareSalesExperienceId);
  requireCompleteSalesParticipantRoster(roster);
  const matches = roster.participants.filter(p => hasRequiredEnrollmentCorrelation(p, enrollment));
  if (matches.length !== 1 || matches[0]!.id !== enrollment.cloudShareParticipantId || matches[0]!.email.toLowerCase() !== enrollment.email.toLowerCase() || roster.participants.some(p => p.id !== matches[0]!.id && p.email.toLowerCase() === enrollment.email.toLowerCase()) || matches[0]!.participationStatus === "concluded") return unavailable();
  if (matches[0]!.participationStatus !== "inProgress" || !matches[0]!.environmentId) return { status: request.selector ? 409 : 200, body: { state: "preparing", message: "Open the trial window and wait for your environment to finish preparing." } };
  const environment = await createCloudShareSalesEnvironmentModule(client).observe({ ownerEmail: enrollment.email, projectId: item.project.id });
  if (environment.state !== "ready" || !environment.expiry.trial || environment.expiry.trial <= now) return { status: request.selector ? 409 : 200, body: { state: environment.state === "preparing" ? "preparing" : "unavailable", message: "Your environment is not ready for remote desktop. Use the trial window to check its state." } };
  const rdp = createCloudShareTrialRdp(client);
  const vms = (await rdp.list(environment.environmentId)).filter(vm => vm.os === "Windows");
  // Opaque correlation only, never authorization: always recheck ownership and fresh membership.
  const selector = (id: string) => createHash("sha256").update(JSON.stringify(["trial-rdp", request.customerId, enrollment.id, environment.environmentId, id])).digest("hex");
  if (!request.selector) return { status: 200, body: { state: vms.some(vm => trialRdpVmAvailability(vm) === "ready") ? "ready" : "unavailable", machines: vms.map(vm => ({ selector: selector(vm.id), name: vm.name || "Windows desktop", state: trialRdpVmAvailability(vm) })), message: vms.length ? "Remote desktop requires a public IP address. Your desktop app may ask for guest credentials." : "No Windows desktops are available. You can still use the trial window." } };
  const chosen = vms.find(vm => selector(vm.id) === request.selector);
  if (!chosen || trialRdpVmAvailability(chosen) !== "ready") return unavailable();
  const file = await rdp.download(environment.environmentId, chosen.id);
  await deps.audit?.write({ id: randomUUID(), occurredAt: now, customerId: request.customerId, actorType: actor.type, actorId: actor.id, actorEmail: actor.email, action: "sales_trial.rdp.download", subjectType: "sales_trial_enrollment", subjectId: enrollment.id, outcome: "success", correlationId, details: { operation: "sales_trial.rdp.download" } });
  return { status: 200, file };
 } catch {
  // Provider exchange observer retains protected evidence. Never serialize the exception.
  await deps.diagnostics?.record({ customerId: request.customerId, source: "sales-trial-rdp", operation: "sales_trial.rdp", outcome: "failure", level: "warn", actor: { type: "sales_trial_participant", id: request.userId }, subject: { type: "sales_trial_offering", id: request.offeringId }, correlationId, message: "Sales Trial remote desktop request failed.", details: { integrationSurface: "cloudshare.trial_rdp" } }).catch(() => undefined);
  return unavailable(502);
 }
}
