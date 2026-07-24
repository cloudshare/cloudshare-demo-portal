export type SalesTab = "items" | "records" | "sessions" | "support" | "configuration";

export const SALES_TABS: readonly SalesTab[] = [
  "sessions",
  "records",
  "items",
  "support",
];

export type SalesItemView = "catalog" | "create" | "detail" | "edit";
export type SalesSessionView = "manage" | "provision";
export type SalesSessionStatusView = "upcoming" | "in_progress" | "needs_attention" | "ended";
export type SalesSessionQueueView = "active" | "needs_attention" | "history";

export interface SalesWorkspaceRouteState {
  readonly tab: SalesTab;
  readonly itemView?: SalesItemView;
  readonly sessionView?: SalesSessionView;
  readonly sessionId?: string;
  readonly sessionStatus?: SalesSessionStatusView;
  readonly queueView?: SalesSessionQueueView;
  readonly queueSearch?: string;
  readonly queueSort?: "start_desc" | "start_asc" | "name_asc";
  readonly queueOffset?: number;
  readonly participantsOpen?: boolean;
  readonly itemId?: string;
  readonly accountId?: string;
  readonly opportunityId?: string;
  readonly correlationId?: string;
  readonly source?: string;
  readonly subjectId?: string;
}

/** A feature requests a Sales destination; only the shell turns it into browser history. */
export interface SalesNavigationIntent {
  readonly tab: SalesTab;
  readonly itemView?: SalesItemView;
  readonly sessionView?: SalesSessionView;
  readonly sessionId?: string | null;
  readonly sessionStatus?: SalesSessionStatusView | null;
  readonly queueView?: SalesSessionQueueView | null;
  readonly queueSearch?: string | null;
  readonly queueSort?: "start_desc" | "start_asc" | "name_asc" | null;
  readonly queueOffset?: number | null;
  readonly participantsOpen?: boolean;
  readonly itemId?: string | null;
  readonly accountId?: string | null;
  readonly opportunityId?: string | null;
  readonly correlationId?: string | null;
  readonly source?: string | null;
  readonly subjectId?: string | null;
  /** Ephemeral creation evidence carried across the Provision-to-queue transition. */
  readonly creationNotice?: {
    readonly message: string;
    readonly correlationId?: string;
  };
  /** Keep a selection change in browser history without moving the user's viewport. */
  readonly preserveScroll?: boolean;
}

export function getSalesTabLabel(tab: SalesTab): string {
  switch (tab) {
    case "items": return "Items";
    case "records": return "Relationships";
    case "sessions": return "Sessions";
    case "support": return "Support";
    case "configuration": return "Configuration";
  }
}

export function buildSalesWorkspaceHref(route: SalesNavigationIntent): string {
  const params = new URLSearchParams();
  params.set("tab", route.tab);
  if (route.tab === "items") {
    const view = route.itemView ?? "catalog";
    const requiresItem = view === "detail" || view === "edit";
    if (view !== "catalog" && (!requiresItem || route.itemId)) params.set("view", view);
    if (requiresItem && route.itemId) params.set("itemId", route.itemId);
  }
  if (route.tab === "records" || route.tab === "sessions") {
    if (route.accountId) params.set("accountId", route.accountId);
    if (route.opportunityId) params.set("opportunityId", route.opportunityId);
  }
  if (route.tab === "sessions") {
    if (route.sessionView === "provision") params.set("view", "provision");
    if (route.sessionId) params.set("sessionId", route.sessionId);
    if (route.sessionView !== "provision" && route.sessionStatus && route.sessionStatus !== "upcoming") params.set("status", route.sessionStatus);
    if (route.sessionView !== "provision" && route.sessionId && route.participantsOpen) params.set("participants", "open");
    if (route.sessionView !== "provision") {
      if (route.queueView && route.queueView !== "active") params.set("queue", route.queueView);
      if (route.queueSearch) params.set("q", route.queueSearch);
      if (route.queueSort && route.queueSort !== "start_desc") params.set("sort", route.queueSort);
      if (route.queueOffset && route.queueOffset > 0) params.set("offset", String(route.queueOffset));
    }
  }
  if (route.tab === "support") { if (route.correlationId) params.set("correlationId", route.correlationId); if (route.source) params.set("source", route.source); if (route.subjectId) params.set("subjectId", route.subjectId); }
  return `/sales?${params.toString()}`;
}

export function parseSalesWorkspaceRouteState(input: {
  readonly tab?: string | readonly string[];
  readonly view?: string | readonly string[];
  readonly itemId?: string | readonly string[];
  readonly accountId?: string | readonly string[];
  readonly opportunityId?: string | readonly string[];
  readonly correlationId?: string | readonly string[];
  readonly source?: string | readonly string[];
  readonly subjectId?: string | readonly string[];
  readonly sessionId?: string | readonly string[];
  readonly status?: string | readonly string[];
  readonly participants?: string | readonly string[];
  readonly queue?: string | readonly string[];
  readonly q?: string | readonly string[];
  readonly sort?: string | readonly string[];
  readonly offset?: string | readonly string[];
}): SalesWorkspaceRouteState {
  const tab = parseTab(readValue(input.tab));
  const itemId = tab === "items" ? readValue(input.itemId) : undefined;
  const parsedItemView = tab === "items" ? parseItemView(readValue(input.view)) : "catalog";
  const itemView = (parsedItemView === "detail" || parsedItemView === "edit") && !itemId
    ? "catalog"
    : parsedItemView;
  const accountId = tab === "records" || tab === "sessions" ? readValue(input.accountId) : undefined;
  const opportunityId = tab === "records" || tab === "sessions" ? readValue(input.opportunityId) : undefined;
  const sessionView = tab === "sessions" && readValue(input.view) === "provision" ? "provision" as const : tab === "sessions" ? "manage" as const : undefined;
  const sessionId = tab === "sessions" ? readValue(input.sessionId) : undefined;
  const sessionStatus = tab === "sessions" ? parseSessionStatus(readValue(input.status)) : undefined;
  const participantsOpen = tab === "sessions" && sessionView === "manage" && Boolean(sessionId) && readValue(input.participants) === "open";
  const queueView = tab === "sessions" && sessionView === "manage" ? parseQueueView(readValue(input.queue)) : undefined;
  const queueSearch = tab === "sessions" && sessionView === "manage" ? readValue(input.q) : undefined;
  const queueSort = tab === "sessions" && sessionView === "manage" ? parseQueueSort(readValue(input.sort)) : undefined;
  const queueOffset = tab === "sessions" && sessionView === "manage" ? parseQueueOffset(readValue(input.offset)) : undefined;
  const correlationId = tab === "support" ? readValue(input.correlationId) : undefined;
  const source = tab === "support" ? readValue(input.source) : undefined;
  const subjectId = tab === "support" ? readValue(input.subjectId) : undefined;
  return {
    tab,
    itemView,
    ...(sessionView ? { sessionView } : {}),
    ...(sessionId ? { sessionId } : {}),
    ...(sessionStatus ? { sessionStatus } : {}),
    ...(participantsOpen ? { participantsOpen: true } : {}),
    ...(queueView ? { queueView } : {}), ...(queueSearch ? { queueSearch } : {}), ...(queueSort ? { queueSort } : {}), ...(queueOffset ? { queueOffset } : {}),
    ...(itemId ? { itemId } : {}),
    ...(accountId ? { accountId } : {}),
    ...(opportunityId ? { opportunityId } : {}),
    ...(correlationId ? { correlationId } : {}),
    ...(source ? { source } : {}), ...(subjectId ? { subjectId } : {}),
  };
}

function parseQueueView(value: string | undefined): SalesSessionQueueView { return value === "needs_attention" || value === "history" ? value : "active"; }
function parseQueueSort(value: string | undefined): SalesWorkspaceRouteState["queueSort"] { return value === "start_asc" || value === "name_asc" ? value : "start_desc"; }
function parseQueueOffset(value: string | undefined): number { const parsed = Number(value); return Number.isInteger(parsed) && parsed > 0 ? parsed : 0; }

function readValue(value: string | readonly string[] | undefined): string | undefined {
  return typeof value === "string" ? value : value?.[0];
}

function parseTab(value: string | undefined): SalesTab {
  if (value === "items" || value === "records" || value === "sessions" || value === "support" || value === "configuration") return value;
  return "sessions";
}

function parseItemView(value: string | undefined): SalesItemView {
  return value === "create" || value === "detail" || value === "edit" ? value : "catalog";
}

function parseSessionStatus(value: string | undefined): SalesSessionStatusView | undefined {
  return value === "upcoming" || value === "in_progress" || value === "needs_attention" || value === "ended" ? value : undefined;
}
