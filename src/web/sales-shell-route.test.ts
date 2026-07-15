import { describe, expect, it } from "vitest";
import { SALES_TABS, buildSalesWorkspaceHref, getSalesTabLabel, parseSalesWorkspaceRouteState } from "./sales-shell-route";

describe("Sales workspace shell routes", () => {
  it("keeps Items first and uses the canonical Item route", () => {
    expect(SALES_TABS).toEqual(["items", "records", "sessions", "support", "configuration"]);
    expect(SALES_TABS.map(getSalesTabLabel)).toEqual(["Items", "Accounts and opportunities", "Sales Enablement Sessions", "Support", "Configuration"]);
    expect(parseSalesWorkspaceRouteState({})).toMatchObject({ tab: "items", itemView: "catalog" });
  });

  it("serialises Item authoring and detail routes without mixing Sales sections", () => {
    expect(buildSalesWorkspaceHref({ tab: "items", itemView: "edit", itemId: "item-1" })).toBe("/sales?tab=items&view=edit&itemId=item-1");
    expect(parseSalesWorkspaceRouteState({ tab: "items", view: "detail", itemId: "item-1" })).toMatchObject({ tab: "items", itemView: "detail", itemId: "item-1" });
    expect(buildSalesWorkspaceHref({ tab: "records", accountId: "account-1", opportunityId: "opportunity-1" })).toBe("/sales?tab=records&accountId=account-1&opportunityId=opportunity-1");
    expect(buildSalesWorkspaceHref({ tab: "sessions", opportunityId: "opportunity-1" })).toBe("/sales?tab=sessions&opportunityId=opportunity-1");
  });

  it("opens Sales Support on the failure correlation thread", () => {
    expect(buildSalesWorkspaceHref({ tab: "support", correlationId: "corr-sales-429" })).toBe("/sales?tab=support&correlationId=corr-sales-429");
    expect(parseSalesWorkspaceRouteState({ tab: "support", correlationId: "corr-sales-429" })).toMatchObject({ tab: "support", correlationId: "corr-sales-429" });
  });
});
