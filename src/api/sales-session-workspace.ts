import type { SalesSessionWorkspaceRepository } from "@/persistence/prisma-sales-session-workspace-repository";
import type { SalesSessionWorkspaceResponse } from "@/domain/sales-session-workspace";

export interface SalesSessionWorkspaceHandlerDeps { readonly workspace: SalesSessionWorkspaceRepository; }
export interface SalesSessionWorkspaceHandlerRequest { readonly customerId: string; readonly sessionId: string; readonly participantQuery?: string; readonly participantPage?: number; readonly participantPageSize?: number; }

/** Framework-agnostic Customer-scoped, local-only read. The repository's
 * metadata-only projection makes protected diagnostic evidence unreachable to
 * this ordinary API and its browser callers. */
export async function handleReadSalesSessionWorkspace(deps: SalesSessionWorkspaceHandlerDeps, request: SalesSessionWorkspaceHandlerRequest): Promise<{ readonly status: 200; readonly body: SalesSessionWorkspaceResponse } | { readonly status: 400 | 404 | 409; readonly body: { readonly error: string } }> {
  if (request.participantQuery !== undefined && request.participantQuery.length > 200) return { status: 400, body: { error: "participantQuery is too long." } };
  if (request.participantPage !== undefined && (!Number.isInteger(request.participantPage) || request.participantPage < 0)) return { status: 400, body: { error: "participantPage must be a non-negative integer." } };
  if (request.participantPageSize !== undefined && (!Number.isInteger(request.participantPageSize) || request.participantPageSize < 1 || request.participantPageSize > 100)) return { status: 400, body: { error: "participantPageSize must be an integer from 1 to 100." } };
  const workspace = request.participantQuery !== undefined || request.participantPage !== undefined || request.participantPageSize !== undefined
    ? await deps.workspace.read(request.customerId, request.sessionId, request)
    : await deps.workspace.read(request.customerId, request.sessionId);
  if (!workspace) return { status: 404, body: { error: "This Sales Session is unavailable for this Customer." } };
  if (workspace.state === "stale") return { status: 409, body: { error: "This Sales Session is an incomplete local reservation and cannot be opened." } };
  const body = workspace.workspace;
  return { status: 200, body: { ...body, activityGroups: body.activityGroups, activityHistory: body.activityHistory ?? { complete: true, hasMore: false } } };
}
