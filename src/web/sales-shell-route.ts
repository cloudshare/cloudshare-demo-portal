export type SalesTab = "items" | "records" | "sessions" | "support" | "configuration";

export const SALES_TABS: readonly SalesTab[] = [
  "sessions",
  "items",
  "records",
  "support",
  "configuration",
];

export type SalesItemView = "catalog" | "create" | "detail" | "edit";

export interface SalesWorkspaceRouteState {
  readonly tab: SalesTab;
  readonly itemView?: SalesItemView;
  readonly itemId?: string;
  readonly accountId?: string;
  readonly opportunityId?: string;
  readonly correlationId?: string;
}

/** A feature requests a Sales destination; only the shell turns it into browser history. */
export interface SalesNavigationIntent {
  readonly tab: SalesTab;
  readonly itemView?: SalesItemView;
  readonly itemId?: string | null;
  readonly accountId?: string | null;
  readonly opportunityId?: string | null;
  readonly correlationId?: string | null;
  /** Keep a selection change in browser history without moving the user's viewport. */
  readonly preserveScroll?: boolean;
}

export function getSalesTabLabel(tab: SalesTab): string {
  switch (tab) {
    case "items": return "Items";
    case "records": return "Accounts and opportunities";
    case "sessions": return "Sales Enablement Sessions";
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
  if (route.tab === "support" && route.correlationId) params.set("correlationId", route.correlationId);
  return `/sales?${params.toString()}`;
}

export function parseSalesWorkspaceRouteState(input: {
  readonly tab?: string | readonly string[];
  readonly view?: string | readonly string[];
  readonly itemId?: string | readonly string[];
  readonly accountId?: string | readonly string[];
  readonly opportunityId?: string | readonly string[];
  readonly correlationId?: string | readonly string[];
}): SalesWorkspaceRouteState {
  const tab = parseTab(readValue(input.tab));
  const itemId = tab === "items" ? readValue(input.itemId) : undefined;
  const parsedItemView = tab === "items" ? parseItemView(readValue(input.view)) : "catalog";
  const itemView = (parsedItemView === "detail" || parsedItemView === "edit") && !itemId
    ? "catalog"
    : parsedItemView;
  const accountId = tab === "records" || tab === "sessions" ? readValue(input.accountId) : undefined;
  const opportunityId = tab === "records" || tab === "sessions" ? readValue(input.opportunityId) : undefined;
  const correlationId = tab === "support" ? readValue(input.correlationId) : undefined;
  return {
    tab,
    itemView,
    ...(itemId ? { itemId } : {}),
    ...(accountId ? { accountId } : {}),
    ...(opportunityId ? { opportunityId } : {}),
    ...(correlationId ? { correlationId } : {}),
  };
}

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
