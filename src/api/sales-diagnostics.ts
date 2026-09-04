import {
  handleGetDiagnosticLog,
  type AdminRequest,
  type AdminResponse,
  type DiagnosticLogHandlerDeps,
} from "./admin";
import { redactDiagnosticInput, type DiagnosticLogEntryInput } from "@/domain/diagnostic-log";

const SALES_DIAGNOSTIC_SOURCES = ["sales-records", "sales-items", "sales-demo-sessions", "sales-session-reconciliation", "sales-session-participants", "sales-project-members", "sales-participant-launch", "sales-trial-offerings", "sales-trial-enrollment"] as const;
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
 * Item integration. Source remains a normal support filter so an admin
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

  const causalTrialQuery = Boolean(request.query.subjectId && (requestedSource === "sales-trial-enrollment" || requestedSource === "sales-trial-offerings"));
  if (requestedSource && !causalTrialQuery) {
    const response = await handleGetDiagnosticLog(deps, { customerId: request.customerId, query: request.query });
    return { ...response, body: projectDiagnosticPage(response.body) };
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
    query: request.query.subjectId ? { ...request.query, subjectId: undefined, ...(causalTrialQuery ? { source: undefined } : {}) } : request.query,
    source,
    requiredEntries: request.query.subjectId ? SALES_DIAGNOSTIC_MAX_AGGREGATE_OFFSET + 1 : requiredEntriesPerSource,
  })));
  const entries = filterCausalSubjectEntries(sourceEntries.flat(), request.query.subjectId?.trim())
    .slice()
    .sort((left: Record<string, unknown>, right: Record<string, unknown>) => String(right.occurredAt).localeCompare(String(left.occurredAt)));
  const pageEntries = entries.slice(requestedOffset, requestedOffset + requestedLimit);
  const hasMore = entries.length > requestedOffset + pageEntries.length;

  return {
    status: 200,
    body: {
      entries: pageEntries.map((entry) => salesBearerSafeProjection(entry)),
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

/** A retained enrollment and its parent Offering are one support workflow. */
function filterCausalSubjectEntries(entries: readonly Record<string, unknown>[], subjectId?: string): readonly Record<string, unknown>[] {
  if (!subjectId) return entries;
  const direct = entries.filter((entry) => {
    const subject = entry.subject as Record<string, unknown> | null | undefined;
    const externalIds = entry.externalIds as Record<string, unknown> | null | undefined;
    return subject?.id === subjectId || Object.values(externalIds ?? {}).some((value) => value === subjectId);
  });
  const enrollmentSubjectMatch = direct.some((entry) => {
    const subject = entry.subject as Record<string, unknown> | null | undefined;
    return subject?.type === "sales_trial_enrollment" && subject.id === subjectId;
  });
  if (!enrollmentSubjectMatch) return direct;
  const offeringIds = new Set(direct.flatMap((entry) => {
    const externalIds = entry.externalIds as Record<string, unknown> | null | undefined;
    const subject = entry.subject as Record<string, unknown> | null | undefined;
    return [externalIds?.offeringId, subject?.type === "sales_trial_offering" ? subject.id : undefined].filter((value): value is string => typeof value === "string");
  }));
  return entries.filter((entry) => {
    if (direct.includes(entry)) return true;
    const externalIds = entry.externalIds as Record<string, unknown> | null | undefined;
    const subject = entry.subject as Record<string, unknown> | null | undefined;
    return subject?.type === "sales_trial_offering" && (offeringIds.has(externalIds?.offeringId as string) || offeringIds.has(subject.id as string));
  });
}

/** Entries have already crossed the direction-aware recorder seam. This
 * authorized admin projection must not re-scrub protected body evidence. */
function salesBearerSafeProjection(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  return redactDiagnosticInput(value as DiagnosticLogEntryInput);
}

function projectDiagnosticPage(value: Record<string, unknown>): Record<string, unknown> {
  const entries = Array.isArray(value.entries)
    ? value.entries.map((entry) => salesBearerSafeProjection(entry))
    : value.entries;
  return { ...value, entries };
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
