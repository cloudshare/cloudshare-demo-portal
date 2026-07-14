import { describe, expect, it } from "vitest";
import { SALES_TABS, buildSalesWorkspaceHref, getSalesTabLabel, parseSalesWorkspaceRouteState } from "./sales-shell-route";

describe("Sales workspace shell routes", () => {
  it("keeps Items first and uses the canonical Item route", () => {
    expect(SALES_TABS).toEqual(["items", "records", "support", "configuration"]);
    expect(SALES_TABS.map(getSalesTabLabel)).toEqual(["Items", "Accounts and opportunities", "Support", "Configuration"]);
    expect(parseSalesWorkspaceRouteState({})).toMatchObject({ tab: "items", itemView: "catalog" });
  });

  it("serialises Item authoring and detail routes without mixing Sales sections", () => {
    expect(buildSalesWorkspaceHref({ tab: "items", itemView: "edit", itemId: "item-1" })).toBe("/sales?tab=items&view=edit&itemId=item-1");
    expect(parseSalesWorkspaceRouteState({ tab: "items", view: "detail", itemId: "item-1" })).toMatchObject({ tab: "items", itemView: "detail", itemId: "item-1" });
    expect(buildSalesWorkspaceHref({ tab: "records", accountId: "account-1", opportunityId: "opportunity-1" })).toBe("/sales?tab=records&accountId=account-1&opportunityId=opportunity-1");
  });
});
