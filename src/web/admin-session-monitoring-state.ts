import type { AdminMonitoringView } from "@/domain/admin-monitoring";

export interface MonitoringHistoryPage {
  readonly limit: number;
  readonly offset: number;
}

export function buildMonitoringHistoryQueryString(page: MonitoringHistoryPage): string {
  const params = new URLSearchParams();
  params.set("historyLimit", String(page.limit));
  params.set("historyOffset", String(page.offset));
  return `?${params.toString()}`;
}

export function mergeMonitoringHistoryPage(
  existing: AdminMonitoringView | null,
  next: AdminMonitoringView,
): AdminMonitoringView {
  if (!existing || next.historyPage.offset === 0) {
    return next;
  }

  const historyById = new Map(existing.history.map((attempt) => [attempt.id, attempt]));
  for (const attempt of next.history) {
    historyById.set(attempt.id, attempt);
  }

  return {
    ...next,
    history: [...historyById.values()],
  };
}
