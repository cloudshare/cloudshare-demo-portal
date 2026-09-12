import type { SalesSessionWorkspaceRepository } from "@/persistence/prisma-sales-session-workspace-repository";
import type { SalesSessionWorkspaceResponse } from "@/domain/sales-session-workspace";

export interface SalesSessionWorkspaceHandlerDeps { readonly workspace: SalesSessionWorkspaceRepository; }
export interface SalesSessionWorkspaceHandlerRequest { readonly customerId: string; readonly sessionId: string; readonly participantQuery?: string; readonly participantPage?: number; readonly participantPageSize?: number; }

/** Framework-agnostic Customer-scoped, local-only read. The repository's
 * metadata-only projection makes protected diagnostic evidence unreachable to
 * this ordinary API and its browser callers. */
export async function handleReadSalesSessionWorkspace(deps: SalesSessionWorkspaceHandlerDeps, request: SalesSessionWorkspaceHandlerRequest): Promise<{ readonly status: 200; readonly body: SalesSessionWorkspaceResponse } | { readonly status: 404 | 409; readonly body: { readonly error: string } }> {
  const workspace = request.participantQuery !== undefined || request.participantPage !== undefined || request.participantPageSize !== undefined
    ? await deps.workspace.read(request.customerId, request.sessionId, request)
    : await deps.workspace.read(request.customerId, request.sessionId);
  if (!workspace) return { status: 404, body: { error: "This Sales Session is unavailable for this Customer." } };
  if (workspace.state === "stale") return { status: 409, body: { error: "This Sales Session is an incomplete local reservation and cannot be opened." } };
  const body = workspace.workspace;
  return { status: 200, body: { ...body, activityGroups: body.activityGroups, activityHistory: body.activityHistory ?? { complete: true, hasMore: false } } };
}
