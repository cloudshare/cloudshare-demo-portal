import {
  handleGetDiagnosticLog,
  type AdminRequest,
  type AdminResponse,
  type DiagnosticLogHandlerDeps,
} from "./admin";

/**
 * Sales support evidence is intentionally narrower than generic Customer
 * diagnostics. The source is owned by this handler, never by the browser.
 */
export async function handleGetSalesDiagnosticLog(
  deps: DiagnosticLogHandlerDeps,
  request: AdminRequest & { readonly customerId: string },
): Promise<AdminResponse> {
  return handleGetDiagnosticLog(deps, {
    customerId: request.customerId,
    query: { ...request.query, source: "sales-records" },
  });
}
