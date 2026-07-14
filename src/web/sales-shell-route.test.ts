import { describe, expect, it } from "vitest";
import {
  SALES_TABS,
  buildSalesWorkspaceHref,
  getSalesTabLabel,
  parseSalesWorkspaceRouteState,
} from "./sales-shell-route";

describe("Sales workspace shell routes", () => {
  it("keeps the confirmed work areas in their intended order", () => {
    expect(SALES_TABS).toEqual(["demo-items", "records", "support", "configuration"]);
    expect(SALES_TABS.map(getSalesTabLabel)).toEqual([
      "Demo items",
      "Accounts and opportunities",
      "Support",
      "Configuration",
    ]);
  });

  it("defaults to the Demo Item catalog and recognises dedicated authoring and detail routes", () => {
    expect(parseSalesWorkspaceRouteState({})).toEqual({
      tab: "demo-items", demoItemView: "catalog", accountId: undefined, opportunityId: undefined,
    });
    expect(parseSalesWorkspaceRouteState({ tab: "demo-items", view: "create" }))
      .toMatchObject({ tab: "demo-items", demoItemView: "create" });
    expect(parseSalesWorkspaceRouteState({ tab: "demo-items", view: "detail", demoItemId: "demo-1" }))
      .toMatchObject({ tab: "demo-items", demoItemView: "detail", demoItemId: "demo-1" });
    expect(parseSalesWorkspaceRouteState({ tab: "demo-items", view: "detail" }))
      .toMatchObject({ tab: "demo-items", demoItemView: "catalog" });
    expect(parseSalesWorkspaceRouteState({ tab: "demo-items", view: "edit" }))
      .toMatchObject({ tab: "demo-items", demoItemView: "catalog" });
  });

  it("serialises nested Demo Item and Account hierarchy routes without mixing tabs", () => {
    expect(buildSalesWorkspaceHref({ tab: "demo-items", demoItemView: "edit", demoItemId: "demo-1" }))
      .toBe("/sales?tab=demo-items&view=edit&demoItemId=demo-1");
    expect(buildSalesWorkspaceHref({ tab: "records", accountId: "account-1", opportunityId: "opportunity-1" }))
      .toBe("/sales?tab=records&accountId=account-1&opportunityId=opportunity-1");
    expect(buildSalesWorkspaceHref({ tab: "support" })).toBe("/sales?tab=support");
  });
});
