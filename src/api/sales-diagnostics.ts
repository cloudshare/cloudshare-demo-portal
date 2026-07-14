import {
  handleGetDiagnosticLog,
  type AdminRequest,
  type AdminResponse,
  type DiagnosticLogHandlerDeps,
} from "./admin";

const SALES_DIAGNOSTIC_SOURCES = ["sales-records", "sales-demo-items"] as const;
const SALES_DIAGNOSTIC_PAGE_LIMIT = 500;

type SalesDiagnosticSource = typeof SALES_DIAGNOSTIC_SOURCES[number];
type DiagnosticPageBody = { readonly entries: readonly Record<string, unknown>[] };

/**
 * Sales support is Customer-scoped but includes local records and the live
 * Demo Item integration. Source remains a normal support filter so an admin
 * can investigate either stream without crossing Customer boundaries.
 */
export async function handleGetSalesDiagnosticLog(
  deps: DiagnosticLogHandlerDeps,
  request: AdminRequest & { readonly customerId: string },
): Promise<AdminResponse> {
  const requestedSource = request.query.source?.trim();
  if (requestedSource && !isSalesDiagnosticSource(requestedSource)) {
    return { status: 400, body: { error: "unsupported_sales_diagnostic_source" } };
  }

  if (requestedSource) {
    return handleGetDiagnosticLog(deps, { customerId: request.customerId, query: request.query });
  }

  const requestedLimit = parsePageNumber(request.query.limit, 100);
  const requestedOffset = parsePageNumber(request.query.offset, 0);
  const responses = await Promise.all(SALES_DIAGNOSTIC_SOURCES.map((source) => handleGetDiagnosticLog(deps, {
    customerId: request.customerId,
    query: { ...request.query, source, limit: String(SALES_DIAGNOSTIC_PAGE_LIMIT), offset: "0" },
  })));
  const entries = responses
    .flatMap((response) => (response.body as DiagnosticPageBody).entries)
    .sort((left, right) => String(right.occurredAt).localeCompare(String(left.occurredAt)));
  const pageEntries = entries.slice(requestedOffset, requestedOffset + requestedLimit);
  const hasMore = entries.length > requestedOffset + pageEntries.length;

  return {
    status: 200,
    body: {
      entries: pageEntries,
      page: {
        limit: requestedLimit,
        offset: requestedOffset,
        returned: pageEntries.length,
        hasMore,
        nextOffset: hasMore ? requestedOffset + pageEntries.length : null,
      },
    },
  };
}

function isSalesDiagnosticSource(value: string): value is SalesDiagnosticSource {
  return (SALES_DIAGNOSTIC_SOURCES as readonly string[]).includes(value);
}

function parsePageNumber(value: string | undefined, fallback: number): number {
  const parsed = value ? Number.parseInt(value, 10) : fallback;
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return Math.min(Math.floor(parsed), SALES_DIAGNOSTIC_PAGE_LIMIT);
}
