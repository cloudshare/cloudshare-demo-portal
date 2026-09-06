export interface DiagnosticLogFilters {
  readonly examAttemptId?: string;
  readonly examId?: string;
  readonly candidateEmail?: string;
  readonly operation?: string;
  readonly outcome?: "success" | "failure";
  readonly source?: string;
  readonly integrationSurface?: string;
  readonly correlationId?: string;
  readonly subjectId?: string;
  readonly subjectType?: string;
  readonly externalId?: string;
  readonly from?: string;
  readonly to?: string;
}

export type AdminTab = "exams" | "candidates" | "support" | "configuration";

export const ADMIN_TABS: readonly AdminTab[] = [
  "exams",
  "candidates",
  "support",
  "configuration",
];

export type AdminExamView = "catalog" | "create" | "edit" | "sessions" | "session";
export type AdminSupportView = "monitoring" | "diagnostics" | "audit";
export type AdminDeliveryView = "individual" | "cohort";

export interface AdminNavigationItem {
  readonly key: string;
  readonly label: string;
  readonly intent: AdminNavigationIntent;
}

export const ADMIN_NAVIGATION_ITEMS: readonly AdminNavigationItem[] = [
  { key: "connection", label: "CloudShare Connection", intent: { tab: "configuration" } },
  { key: "catalog", label: "Exam catalog", intent: { tab: "exams", examView: "catalog" } },
  { key: "candidates", label: "Candidates", intent: { tab: "candidates" } },
  { key: "individual-delivery", label: "Individual delivery", intent: { tab: "exams", examView: "catalog", deliveryView: "individual" } },
  { key: "cohort-delivery", label: "Cohort delivery", intent: { tab: "exams", examView: "catalog", deliveryView: "cohort" } },
  { key: "support", label: "Support", intent: { tab: "support", supportView: "monitoring" } },
];

export const ADMIN_SUPPORT_NAVIGATION_ITEMS: readonly AdminNavigationItem[] = [
  { key: "monitoring", label: "Session Monitoring", intent: { tab: "support", supportView: "monitoring" } },
  { key: "diagnostics", label: "Support Diagnostics", intent: { tab: "support", supportView: "diagnostics" } },
  { key: "audit", label: "Audit", intent: { tab: "support", supportView: "audit" } },
];

export interface AdminConsoleRouteState {
  readonly tab: AdminTab;
  readonly examView: AdminExamView;
  readonly examId?: string;
  readonly cohortSessionId?: string;
  readonly supportView: AdminSupportView;
  readonly deliveryView: AdminDeliveryView | null;
  readonly diagnosticFilters: DiagnosticLogFilters;
  readonly routeNotice?: string;
}

/**
 * A feature requests a destination in portal terms. The shell alone turns it
 * into a browser URL and updates browser history.
 */
export interface AdminNavigationIntent {
  readonly tab: AdminTab;
  readonly examView?: AdminExamView;
  readonly examId?: string | null;
  readonly cohortSessionId?: string | null;
  readonly supportView?: AdminSupportView;
  readonly deliveryView?: AdminDeliveryView | null;
  readonly diagnosticFilters?: DiagnosticLogFilters;
}

export interface SupportDiagnosticsNavigationIntent extends AdminNavigationIntent {
  readonly tab: "support";
  readonly supportView: "diagnostics";
  readonly diagnosticFilters: DiagnosticLogFilters;
}

export function createSupportDiagnosticsNavigationIntent(
  diagnosticFilters: DiagnosticLogFilters,
): SupportDiagnosticsNavigationIntent {
  return {
    tab: "support",
    supportView: "diagnostics",
    diagnosticFilters,
  };
}

export function getAdminTabLabel(tab: AdminTab): string {
  switch (tab) {
    case "exams":
      return "Exams";
    case "candidates":
      return "Candidates";
    case "support":
      return "Support";
    case "configuration":
      return "Configuration";
  }
}

export function getAdminSupportViewLabel(view: AdminSupportView): string {
  switch (view) {
    case "monitoring":
      return "Session Monitoring";
    case "diagnostics":
      return "Support Diagnostics";
    case "audit":
      return "Audit Trail";
  }
}

export function shouldClearAdminBannerOnTabChange(from: AdminTab, to: AdminTab): boolean {
  return from !== to;
}

function normaliseOptionalText(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export function normaliseDiagnosticLogFilters(
  filters: DiagnosticLogFilters,
): DiagnosticLogFilters {
  return {
    ...(normaliseOptionalText(filters.examAttemptId)
      ? { examAttemptId: normaliseOptionalText(filters.examAttemptId) }
      : {}),
    ...(normaliseOptionalText(filters.examId) ? { examId: normaliseOptionalText(filters.examId) } : {}),
    ...(normaliseOptionalText(filters.candidateEmail)
      ? { candidateEmail: normaliseOptionalText(filters.candidateEmail)?.toLowerCase() }
      : {}),
    ...(normaliseOptionalText(filters.operation)
      ? { operation: normaliseOptionalText(filters.operation) }
      : {}),
    ...(filters.outcome ? { outcome: filters.outcome } : {}),
    ...(normaliseOptionalText(filters.source) ? { source: normaliseOptionalText(filters.source) } : {}),
    ...(normaliseOptionalText(filters.integrationSurface)
      ? { integrationSurface: normaliseOptionalText(filters.integrationSurface) }
      : {}),
    ...(normaliseOptionalText(filters.correlationId)
      ? { correlationId: normaliseOptionalText(filters.correlationId) }
      : {}),
    ...(normaliseOptionalText(filters.subjectId) ? { subjectId: normaliseOptionalText(filters.subjectId) } : {}),
    ...(normaliseOptionalText(filters.subjectType) ? { subjectType: normaliseOptionalText(filters.subjectType) } : {}),
    ...(normaliseOptionalText(filters.externalId)
      ? { externalId: normaliseOptionalText(filters.externalId) }
      : {}),
    ...(normaliseOptionalText(filters.from) ? { from: normaliseOptionalText(filters.from) } : {}),
    ...(normaliseOptionalText(filters.to) ? { to: normaliseOptionalText(filters.to) } : {}),
  };
}

export function buildAdminConsoleHref(
  route: Partial<AdminConsoleRouteState> & { readonly tab: AdminTab },
): string {
  const params = new URLSearchParams();
  params.set("tab", route.tab);

  if (route.tab === "exams" || route.tab === "support") {
    const examView = route.examView ?? "catalog";
    if (route.tab === "exams" && examView !== "catalog") {
      params.set("view", examView);
    }
    if (route.examId) {
      params.set("examId", route.examId);
    }
    if (route.cohortSessionId) {
      params.set("sessionId", route.cohortSessionId);
    }
  }

  if (route.tab === "support") {
    const supportView = route.supportView ?? "monitoring";
    if (supportView !== "monitoring") {
      params.set("view", supportView);
    }
  }

  if ((route.tab === "exams" || (route.tab === "support" && (route.supportView ?? "monitoring") === "monitoring")) && route.deliveryView) {
    params.set("delivery", route.deliveryView);
  }

  if (route.tab === "support" && (route.supportView ?? "monitoring") === "diagnostics") {
    const filters = normaliseDiagnosticLogFilters(route.diagnosticFilters ?? {});
    for (const [key, value] of Object.entries(filters)) {
      if (value) {
        params.set(key, value);
      }
    }
  }

  const query = params.toString();
  return query ? `/admin?${query}` : "/admin";
}

export function buildAdminNavigationHref(intent: AdminNavigationIntent): string {
  return buildAdminConsoleHref({
    tab: intent.tab,
    examView: intent.examView,
    examId: intent.examId ?? undefined,
    cohortSessionId: intent.cohortSessionId ?? undefined,
    supportView: intent.supportView,
    deliveryView: intent.deliveryView,
    diagnosticFilters: intent.diagnosticFilters,
  });
}

export function createExamAttemptDiagnosticsNavigationIntent(
  examAttemptId: string,
): SupportDiagnosticsNavigationIntent {
  return createSupportDiagnosticsNavigationIntent({ examAttemptId: examAttemptId.trim() });
}

export function createCorrelationDiagnosticsNavigationIntent(
  correlationId: string,
): SupportDiagnosticsNavigationIntent {
  return createSupportDiagnosticsNavigationIntent({ correlationId: correlationId.trim() });
}

export function parseAdminConsoleRouteState(input: {
  readonly tab?: string | readonly string[];
  readonly view?: string | readonly string[];
  readonly examId?: string | readonly string[];
  readonly sessionId?: string | readonly string[];
  readonly examAttemptId?: string | readonly string[];
  readonly candidateEmail?: string | readonly string[];
  readonly operation?: string | readonly string[];
  readonly outcome?: string | readonly string[];
  readonly source?: string | readonly string[];
  readonly integrationSurface?: string | readonly string[];
  readonly correlationId?: string | readonly string[];
  readonly subjectId?: string | readonly string[];
  readonly subjectType?: string | readonly string[];
  readonly externalId?: string | readonly string[];
  readonly from?: string | readonly string[];
  readonly to?: string | readonly string[];
  readonly delivery?: string | readonly string[];
}): AdminConsoleRouteState {
  const { tab, supportView } = parseAdminTabWithSupportView(input.tab, input.view);
  const examView = tab === "exams" ? parseAdminExamView(input.view) : "catalog";
  const deliveryCandidate = readRouteValue(input.delivery);
  const parsedDeliveryView = parseAdminDeliveryView(input.delivery);
  const deliveryView = tab === "exams"
    ? examView === "sessions" || examView === "session"
      ? "cohort"
      : examView === "create" || examView === "edit" ? null : parsedDeliveryView
    : tab === "support" && supportView === "monitoring" ? parsedDeliveryView : null;
  const acceptsDeliveryRoute = (tab === "exams" && examView === "catalog")
    || (tab === "support" && supportView === "monitoring");
  const routeNotice = deliveryCandidate && acceptsDeliveryRoute && !deliveryView
    ? "That delivery destination is no longer available. A safe current view is shown instead."
    : undefined;
  const examId = tab === "exams" || tab === "support" ? readRouteValue(input.examId) : undefined;
  const cohortSessionId = tab === "exams" || tab === "support" ? readRouteValue(input.sessionId) : undefined;
  if (tab !== "support" || supportView !== "diagnostics") {
    return {
      tab,
      examView,
      ...(examId ? { examId } : {}),
      ...(cohortSessionId ? { cohortSessionId } : {}),
      supportView,
      deliveryView,
      diagnosticFilters: {},
      ...(routeNotice ? { routeNotice } : {}),
    };
  }

  return {
    tab,
    examView,
    ...(examId ? { examId } : {}),
    ...(cohortSessionId ? { cohortSessionId } : {}),
    supportView,
    deliveryView,
    diagnosticFilters: normaliseDiagnosticLogFilters({
      examAttemptId: readRouteValue(input.examAttemptId),
      examId: readRouteValue(input.examId),
      candidateEmail: readRouteValue(input.candidateEmail),
      operation: readRouteValue(input.operation),
      outcome: parseOutcome(input.outcome),
      source: readRouteValue(input.source),
      integrationSurface: readRouteValue(input.integrationSurface),
      correlationId: readRouteValue(input.correlationId),
      subjectId: readRouteValue(input.subjectId),
      subjectType: readRouteValue(input.subjectType),
      externalId: readRouteValue(input.externalId),
      from: readRouteValue(input.from),
      to: readRouteValue(input.to),
    }),
    ...(routeNotice ? { routeNotice } : {}),
  };
}

function parseAdminDeliveryView(value: string | readonly string[] | undefined): AdminDeliveryView | null {
  const candidate = readRouteValue(value);
  return candidate === "individual" || candidate === "cohort" ? candidate : null;
}

function readRouteValue(value: string | readonly string[] | undefined): string | undefined {
  return typeof value === "string" ? value : value?.[0];
}

function parseAdminTabWithSupportView(
  value: string | readonly string[] | undefined,
  view: string | readonly string[] | undefined,
): { tab: AdminTab; supportView: AdminSupportView } {
  const candidate = readRouteValue(value);
  if (candidate === "connection" || candidate === "configuration") {
    return { tab: "configuration", supportView: "monitoring" };
  }
  if (candidate === "monitoring" || candidate === "audit" || candidate === "diagnostics") {
    return { tab: "support", supportView: candidate };
  }
  if (candidate === "support") {
    return { tab: "support", supportView: parseAdminSupportView(view) };
  }
  if (candidate === "candidates") {
    return { tab: "candidates", supportView: "monitoring" };
  }
  return { tab: "exams", supportView: "monitoring" };
}

function parseAdminExamView(value: string | readonly string[] | undefined): AdminExamView {
  const candidate = readRouteValue(value);
  return candidate === "create" ||
    candidate === "edit" ||
    candidate === "sessions" ||
    candidate === "session"
    ? candidate
    : "catalog";
}

function parseAdminSupportView(value: string | readonly string[] | undefined): AdminSupportView {
  const candidate = readRouteValue(value);
  return candidate === "diagnostics" || candidate === "audit" ? candidate : "monitoring";
}

function parseOutcome(
  value: string | readonly string[] | undefined,
): DiagnosticLogFilters["outcome"] | undefined {
  const candidate = readRouteValue(value);
  return candidate === "success" || candidate === "failure" ? candidate : undefined;
}
