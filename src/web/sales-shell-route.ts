export type SalesTab = "demo-items" | "records" | "support" | "configuration";

export const SALES_TABS: readonly SalesTab[] = [
  "demo-items",
  "records",
  "support",
  "configuration",
];

export type SalesDemoItemView = "catalog" | "create" | "detail" | "edit";

export interface SalesWorkspaceRouteState {
  readonly tab: SalesTab;
  readonly demoItemView: SalesDemoItemView;
  readonly demoItemId?: string;
  readonly accountId?: string;
  readonly opportunityId?: string;
}

/** A feature requests a Sales destination; only the shell turns it into browser history. */
export interface SalesNavigationIntent {
  readonly tab: SalesTab;
  readonly demoItemView?: SalesDemoItemView;
  readonly demoItemId?: string | null;
  readonly accountId?: string | null;
  readonly opportunityId?: string | null;
}

export function getSalesTabLabel(tab: SalesTab): string {
  switch (tab) {
    case "demo-items": return "Demo items";
    case "records": return "Accounts and opportunities";
    case "support": return "Support";
    case "configuration": return "Configuration";
  }
}

export function buildSalesWorkspaceHref(route: SalesNavigationIntent): string {
  const params = new URLSearchParams();
  params.set("tab", route.tab);
  if (route.tab === "demo-items") {
    const view = route.demoItemView ?? "catalog";
    if (view !== "catalog") params.set("view", view);
    if (route.demoItemId) params.set("demoItemId", route.demoItemId);
  }
  if (route.tab === "records") {
    if (route.accountId) params.set("accountId", route.accountId);
    if (route.opportunityId) params.set("opportunityId", route.opportunityId);
  }
  return `/sales?${params.toString()}`;
}

export function parseSalesWorkspaceRouteState(input: {
  readonly tab?: string | readonly string[];
  readonly view?: string | readonly string[];
  readonly demoItemId?: string | readonly string[];
  readonly accountId?: string | readonly string[];
  readonly opportunityId?: string | readonly string[];
}): SalesWorkspaceRouteState {
  const tab = parseTab(readValue(input.tab));
  const demoItemView = tab === "demo-items" ? parseDemoItemView(readValue(input.view)) : "catalog";
  const demoItemId = tab === "demo-items" ? readValue(input.demoItemId) : undefined;
  const accountId = tab === "records" ? readValue(input.accountId) : undefined;
  const opportunityId = tab === "records" ? readValue(input.opportunityId) : undefined;
  return {
    tab,
    demoItemView,
    ...(demoItemId ? { demoItemId } : {}),
    ...(accountId ? { accountId } : {}),
    ...(opportunityId ? { opportunityId } : {}),
  };
}

function readValue(value: string | readonly string[] | undefined): string | undefined {
  return typeof value === "string" ? value : value?.[0];
}

function parseTab(value: string | undefined): SalesTab {
  if (value === "records" || value === "support" || value === "configuration") return value;
  return "demo-items";
}

function parseDemoItemView(value: string | undefined): SalesDemoItemView {
  return value === "create" || value === "detail" || value === "edit" ? value : "catalog";
}
