import type { SalesSessionWorkspaceRepository } from "@/persistence/prisma-sales-session-workspace-repository";

export interface SalesSessionWorkspaceHandlerDeps { readonly workspace: SalesSessionWorkspaceRepository; }
export interface SalesSessionWorkspaceHandlerRequest { readonly customerId: string; readonly sessionId: string; }

/** Framework-agnostic Customer-scoped, local-only read. The repository's
 * metadata-only projection makes protected diagnostic evidence unreachable to
 * this ordinary API and its browser callers. */
export async function handleReadSalesSessionWorkspace(deps: SalesSessionWorkspaceHandlerDeps, request: SalesSessionWorkspaceHandlerRequest) {
  const workspace = await deps.workspace.read(request.customerId, request.sessionId);
  if (!workspace) return { status: 404, body: { error: "This Sales Session is unavailable for this Customer." } };
  return { status: 200, body: workspace };
}
