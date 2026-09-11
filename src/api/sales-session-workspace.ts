import type { SalesSessionWorkspaceRepository } from "@/persistence/prisma-sales-session-workspace-repository";
import { groupSafeSalesSessionActivity, type SalesSessionWorkspaceResponse } from "@/domain/sales-session-workspace";

export interface SalesSessionWorkspaceHandlerDeps { readonly workspace: SalesSessionWorkspaceRepository; }
export interface SalesSessionWorkspaceHandlerRequest { readonly customerId: string; readonly sessionId: string; }

/** Framework-agnostic Customer-scoped, local-only read. The repository's
 * metadata-only projection makes protected diagnostic evidence unreachable to
 * this ordinary API and its browser callers. */
export async function handleReadSalesSessionWorkspace(deps: SalesSessionWorkspaceHandlerDeps, request: SalesSessionWorkspaceHandlerRequest): Promise<{ readonly status: 200; readonly body: SalesSessionWorkspaceResponse } | { readonly status: 404 | 409; readonly body: { readonly error: string } }> {
  const workspace = await deps.workspace.read(request.customerId, request.sessionId);
  if (!workspace) return { status: 404, body: { error: "This Sales Session is unavailable for this Customer." } };
  if (workspace.state === "stale") return { status: 409, body: { error: "This Sales Session is an incomplete local reservation and cannot be opened." } };
  const body = workspace.workspace;
  return { status: 200, body: { ...body, activityGroups: body.activityGroups ?? groupSafeSalesSessionActivity(body.activity), activityHistory: body.activityHistory ?? { complete: true, omittedCount: 0 } } };
}
