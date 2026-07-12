import {
  normaliseDiagnosticLogFilters,
  type DiagnosticLogFilters,
} from "./admin-shell-route";

export interface DiagnosticLogPage {
  readonly limit: number;
  readonly offset: number;
}

export function buildDiagnosticLogQueryString(
  filters: DiagnosticLogFilters,
  page: DiagnosticLogPage,
): string {
  const params = new URLSearchParams();
  const normalised = normaliseDiagnosticLogFilters(filters);
  for (const [key, value] of Object.entries(normalised)) {
    if (value) params.set(key, value);
  }
  params.set("limit", String(page.limit));
  params.set("offset", String(page.offset));
  const query = params.toString();
  return query ? `?${query}` : "";
}
