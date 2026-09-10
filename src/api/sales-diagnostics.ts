import {
  handleGetDiagnosticLog,
  type AdminRequest,
  type AdminResponse,
  type DiagnosticLogHandlerDeps,
} from "./admin";
import { redactDiagnosticInput, type DiagnosticLogEntryInput } from "@/domain/diagnostic-log";
import type { SalesTrialEnrollmentRepository } from "@/domain/sales-trial-enrollment";

const SALES_DIAGNOSTIC_SOURCES = ["sales-records", "sales-items", "sales-demo-sessions", "sales-session-reconciliation", "sales-session-participants", "sales-project-members", "sales-participant-launch", "sales-trial-offerings", "sales-trial-enrollment", "cloudshare-integration"] as const;
const SALES_DIAGNOSTIC_SOURCE_PAGE_LIMIT = 500;
const SALES_DIAGNOSTIC_MAX_PAGE_LIMIT = 500;
const SALES_DIAGNOSTIC_MAX_AGGREGATE_OFFSET = 5_000;

type SalesDiagnosticSource = typeof SALES_DIAGNOSTIC_SOURCES[number];
type SalesTrialEnrollmentReader = Pick<SalesTrialEnrollmentRepository, "findById"> & {
  readonly findById: NonNullable<SalesTrialEnrollmentRepository["findById"]>;
};
type SalesTrialEnrollmentDependency = SalesTrialEnrollmentReader | SalesTrialEnrollmentRepository;
type DiagnosticPageBody = {
  readonly entries: readonly Record<string, unknown>[];
  readonly page: { readonly hasMore: boolean; readonly nextOffset: number | null; readonly complete?: boolean; readonly continuation?: string | null };
};

/**
 * Sales support is Customer-scoped but includes local records and the live
 * Item integration. Source remains a normal support filter so an admin
 * can investigate either stream without crossing Customer boundaries.
 */
export async function handleGetSalesDiagnosticLog(
  deps: DiagnosticLogHandlerDeps & { readonly salesTrialEnrollments?: SalesTrialEnrollmentDependency },
  request: AdminRequest & { readonly customerId: string },
): Promise<AdminResponse> {
  const requestedSource = request.query.source?.trim();
  const requestedLimit = parseLimit(request.query.limit);
  const requestedOffset = parseOffset(request.query.offset);
  if (requestedOffset > SALES_DIAGNOSTIC_MAX_AGGREGATE_OFFSET) return { status: 400, body: { error: "sales_diagnostic_offset_exceeds_maximum", maxOffset: SALES_DIAGNOSTIC_MAX_AGGREGATE_OFFSET } };
  if (requestedSource && !isSalesDiagnosticSource(requestedSource)) {
    return { status: 400, body: { error: "unsupported_sales_diagnostic_source" } };
  }

  const causalTrialQuery = Boolean(request.query.subjectId && (request.query.subjectType === "sales_trial_enrollment" || request.query.subjectType === "sales_trial_offering"));
  if (requestedSource && !causalTrialQuery) {
    const response = await handleGetDiagnosticLog(deps, { customerId: request.customerId, query: request.query });
    const projected = projectDiagnosticPage(response.body);
    if (requestedOffset + requestedLimit > SALES_DIAGNOSTIC_MAX_AGGREGATE_OFFSET) {
      const body = projected as Record<string, unknown>;
      const page = body.page as Record<string, unknown>;
      return { status: response.status, body: { ...body, page: { ...page, hasMore: false, nextOffset: null, complete: false, incompleteReason: "sales_diagnostic_offset_cap", continuation: null } } };
    }
    return { status: response.status, body: projected };
  }

  if (causalTrialQuery) {
    const subjectEntries = await readCausalSubjectEntries(deps, request.customerId, request.query, request.query.subjectId!.trim(), requestedOffset, requestedLimit);
    const pageEntries = subjectEntries.slice(requestedOffset, requestedOffset + requestedLimit);
    const candidateNextOffset = requestedOffset + pageEntries.length;
    const hasMore = subjectEntries.length > candidateNextOffset;
    const bounded = hasMore && candidateNextOffset > SALES_DIAGNOSTIC_MAX_AGGREGATE_OFFSET;
    return { status: 200, body: { entries: pageEntries.map(salesBearerSafeProjection), page: { limit: requestedLimit, offset: requestedOffset, returned: pageEntries.length, hasMore: hasMore && !bounded, nextOffset: hasMore && !bounded ? candidateNextOffset : null, complete: !bounded && !hasMore, incompleteReason: bounded ? "sales_diagnostic_offset_cap" : undefined, continuation: hasMore ? `offset=${candidateNextOffset}` : null } } };
  }

  const requiredEntriesPerSource = requestedOffset + requestedLimit + 1;
  const sourceEntries = await Promise.all(SALES_DIAGNOSTIC_SOURCES.map((source) => readSourceEntries({
    deps,
    customerId: request.customerId,
    query: request.query,
    source,
    requiredEntries: requiredEntriesPerSource,
  })));
  const entries = sourceEntries.flat()
    .slice()
    .sort(compareWorkflowDiagnostics);
  const pageEntries = entries.slice(requestedOffset, requestedOffset + requestedLimit);
  const candidateNextOffset = requestedOffset + pageEntries.length;
  const undisclosed = entries.length > candidateNextOffset;
  const bounded = requestedOffset + requestedLimit > SALES_DIAGNOSTIC_MAX_AGGREGATE_OFFSET || (undisclosed && candidateNextOffset > SALES_DIAGNOSTIC_MAX_AGGREGATE_OFFSET);

  return {
    status: 200,
    body: {
      entries: pageEntries.map((entry) => salesBearerSafeProjection(entry)),
      page: {
        limit: requestedLimit,
        offset: requestedOffset,
        returned: pageEntries.length,
        hasMore: undisclosed && !bounded,
        nextOffset: undisclosed && !bounded ? candidateNextOffset : null,
        complete: !bounded && !undisclosed,
        incompleteReason: bounded ? "sales_diagnostic_offset_cap" : undefined,
        continuation: undisclosed ? `offset=${candidateNextOffset}` : null,
      },
    },
  };
}

async function readCausalSubjectEntries(deps: DiagnosticLogHandlerDeps & { readonly salesTrialEnrollments?: SalesTrialEnrollmentDependency }, customerId: string, query: AdminRequest["query"], subjectId: string, offset: number, limit: number): Promise<readonly Record<string, unknown>[]> {
  const requestedType = query.subjectType;
  const enrollmentReader = deps.salesTrialEnrollments as SalesTrialEnrollmentReader | undefined;
  let enrollment = null;
  if (requestedType === "sales_trial_enrollment") {
    if (!enrollmentReader) throw new Error("Sales diagnostics enrollment reader is not configured");
    enrollment = await enrollmentReader.findById(customerId, subjectId);
  }
  const base = { ...query, subjectId, subjectType: requestedType, limit: String(offset + limit + 1), offset: "0" };
  const requestedSource = query.source;
  const sources: SalesDiagnosticSource[] = requestedType === "sales_trial_offering"
    ? (requestedSource === undefined
        ? ["sales-trial-offerings", "sales-trial-enrollment"]
        : requestedSource === "sales-trial-offerings"
          ? ["sales-trial-offerings"]
          : [])
    : (requestedSource === undefined ? ["sales-trial-enrollment"] : requestedSource === "sales-trial-enrollment" ? ["sales-trial-enrollment"] : []);
  const direct = (await Promise.all(sources.map((source) => readSourceEntries({ deps, customerId, query: { ...base, source }, source, requiredEntries: offset + limit + 1 })))).flat().filter((entry) => {
    const subject = entry.subject as Record<string, unknown> | null;
    return subject?.id === subjectId && (subject.type === "sales_trial_offering" || subject.type === "sales_trial_enrollment");
  });
  if (requestedType === "sales_trial_offering") return direct.sort((a, b) => String(b.occurredAt).localeCompare(String(a.occurredAt)));
  const enrollmentEntries = direct.filter((entry) => (entry.subject as Record<string, unknown> | null)?.type === "sales_trial_enrollment");
  const offeringId = enrollment?.salesTrialOfferingId;
  if (!enrollmentEntries.length && typeof offeringId !== "string") return direct.sort((a, b) => String(b.occurredAt).localeCompare(String(a.occurredAt)));
  if (typeof offeringId !== "string") return enrollmentEntries.sort((a, b) => String(b.occurredAt).localeCompare(String(a.occurredAt)));
  const parentSources: SalesDiagnosticSource[] = requestedSource === undefined
    ? ["sales-trial-offerings", "sales-trial-enrollment"]
    : requestedSource === "sales-trial-offerings"
      ? ["sales-trial-offerings"]
      : [];
  const parent = parentSources.length
    ? (await Promise.all(parentSources.map((source) => readSourceEntries({ deps, customerId, query: { ...base, source, subjectId: offeringId, subjectType: "sales_trial_offering" }, source, requiredEntries: offset + limit + 1 })))).flat().filter((entry) => {
      const subject = entry.subject as Record<string, unknown> | null;
      return subject?.type === "sales_trial_offering" && subject.id === offeringId;
    })
    : [];
  return [...new Map([...enrollmentEntries, ...parent].map((entry) => [entry.id, entry])).values()].sort((a, b) => String(b.occurredAt).localeCompare(String(a.occurredAt)));
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
  const page = value.page && typeof value.page === "object" ? value.page as Record<string, unknown> : {};
  const offset = typeof page.offset === "number" ? page.offset : 0;
  const hasMore = page.hasMore === true;
  // At the hard offset boundary a full-looking page can still be the last
  // page returned by the bounded source scan; it is not proof that older
  // evidence does not exist. Mark any non-empty boundary page incomplete.
  const capped = offset >= SALES_DIAGNOSTIC_MAX_AGGREGATE_OFFSET && (hasMore || (Array.isArray(page.entries) && page.entries.length > 0) || (typeof page.returned === "number" && page.returned > 0));
  return { ...value, entries, page: { ...page, hasMore: capped ? false : hasMore, nextOffset: capped ? null : (typeof page.nextOffset === "number" ? page.nextOffset : null), complete: capped ? false : page.complete !== false, ...(capped ? { incompleteReason: "sales_diagnostic_offset_cap", continuation: null } : {}) } };
}

function compareWorkflowDiagnostics(left: Record<string, unknown>, right: Record<string, unknown>): number {
  const leftSequence = workflowSequence(left);
  const rightSequence = workflowSequence(right);
  if (leftSequence !== undefined && rightSequence !== undefined && leftSequence !== rightSequence) return leftSequence - rightSequence;
  if (leftSequence !== undefined && rightSequence === undefined) return -1;
  if (leftSequence === undefined && rightSequence !== undefined) return 1;
  const leftExchange = exchangeId(left);
  const rightExchange = exchangeId(right);
  if (leftExchange && rightExchange && leftExchange !== rightExchange) return leftExchange.localeCompare(rightExchange);
  return String(right.occurredAt).localeCompare(String(left.occurredAt)) || String(right.id).localeCompare(String(left.id));
}
function workflowSequence(value: Record<string, unknown>): number | undefined { const details = value.details as Record<string, unknown> | null | undefined; return typeof details?.attemptStartSequence === "number" ? details.attemptStartSequence : undefined; }
function exchangeId(value: Record<string, unknown>): string | undefined { const details = value.details as Record<string, unknown> | null | undefined; return typeof details?.exchangeId === "string" ? details.exchangeId : undefined; }

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
