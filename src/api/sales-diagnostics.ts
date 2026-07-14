import {
  handleGetDiagnosticLog,
  type AdminRequest,
  type AdminResponse,
  type DiagnosticLogHandlerDeps,
} from "./admin";

const SALES_DIAGNOSTIC_SOURCES = ["sales-records", "sales-demo-items"] as const;
const SALES_DIAGNOSTIC_SOURCE_PAGE_LIMIT = 500;
const SALES_DIAGNOSTIC_MAX_PAGE_LIMIT = 500;
const SALES_DIAGNOSTIC_MAX_AGGREGATE_OFFSET = 5_000;

type SalesDiagnosticSource = typeof SALES_DIAGNOSTIC_SOURCES[number];
type DiagnosticPageBody = {
  readonly entries: readonly Record<string, unknown>[];
  readonly page: { readonly hasMore: boolean; readonly nextOffset: number | null };
};

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

  const requestedLimit = parseLimit(request.query.limit);
  const requestedOffset = parseOffset(request.query.offset);
  if (requestedOffset > SALES_DIAGNOSTIC_MAX_AGGREGATE_OFFSET) {
    return {
      status: 400,
      body: {
        error: "sales_diagnostic_offset_exceeds_maximum",
        maxOffset: SALES_DIAGNOSTIC_MAX_AGGREGATE_OFFSET,
      },
    };
  }
  const requiredEntriesPerSource = requestedOffset + requestedLimit + 1;
  const sourceEntries = await Promise.all(SALES_DIAGNOSTIC_SOURCES.map((source) => readSourceEntries({
    deps,
    customerId: request.customerId,
    query: request.query,
    source,
    requiredEntries: requiredEntriesPerSource,
  })));
  const entries = sourceEntries
    .flat()
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

async function readSourceEntries(input: {
  readonly deps: DiagnosticLogHandlerDeps;
  readonly customerId: string;
  readonly query: AdminRequest["query"];
  readonly source: SalesDiagnosticSource;
  readonly requiredEntries: number;
}): Promise<readonly Record<string, unknown>[]> {
  const entries: Record<string, unknown>[] = [];
  let offset = 0;
  while (entries.length < input.requiredEntries) {
    const limit = Math.min(SALES_DIAGNOSTIC_SOURCE_PAGE_LIMIT, input.requiredEntries - entries.length);
    const response = await handleGetDiagnosticLog(input.deps, {
      customerId: input.customerId,
      query: { ...input.query, source: input.source, limit: String(limit), offset: String(offset) },
    });
    const body = response.body as DiagnosticPageBody;
    entries.push(...body.entries);
    if (!body.page.hasMore || body.page.nextOffset === null) break;
    offset = body.page.nextOffset;
  }
  return entries;
}

function parseLimit(value: string | undefined): number {
  const parsed = value ? Number.parseInt(value, 10) : 100;
  if (!Number.isFinite(parsed) || parsed <= 0) return 100;
  return Math.min(Math.floor(parsed), SALES_DIAGNOSTIC_MAX_PAGE_LIMIT);
}

function parseOffset(value: string | undefined): number {
  const parsed = value ? Number.parseInt(value, 10) : 0;
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  return Math.floor(parsed);
}
