import { describe, expect, it } from "vitest";
import { SALES_TABS, buildSalesWorkspaceHref, getSalesTabLabel, parseSalesWorkspaceRouteState } from "./sales-shell-route";

describe("Sales workspace shell routes", () => {
  it("keeps Sessions first while retaining the canonical Item route", () => {
    expect(SALES_TABS).toEqual(["sessions", "items", "records", "support", "configuration"]);
    expect(SALES_TABS.map(getSalesTabLabel)).toEqual(["Sales Enablement Sessions", "Items", "Accounts and opportunities", "Support", "Configuration"]);
    expect(parseSalesWorkspaceRouteState({})).toMatchObject({ tab: "sessions", itemView: "catalog" });
  });

  it("serialises Item authoring and detail routes without mixing Sales sections", () => {
    expect(buildSalesWorkspaceHref({ tab: "items", itemView: "edit", itemId: "item-1" })).toBe("/sales?tab=items&view=edit&itemId=item-1");
    expect(parseSalesWorkspaceRouteState({ tab: "items", view: "detail", itemId: "item-1" })).toMatchObject({ tab: "items", itemView: "detail", itemId: "item-1" });
    expect(buildSalesWorkspaceHref({ tab: "records", accountId: "account-1", opportunityId: "opportunity-1" })).toBe("/sales?tab=records&accountId=account-1&opportunityId=opportunity-1");
    expect(buildSalesWorkspaceHref({ tab: "sessions", opportunityId: "opportunity-1" })).toBe("/sales?tab=sessions&opportunityId=opportunity-1");
    expect(buildSalesWorkspaceHref({ tab: "sessions", sessionView: "provision", sessionId: "session-1" })).toBe("/sales?tab=sessions&view=provision&sessionId=session-1");
    expect(buildSalesWorkspaceHref({ tab: "sessions", sessionView: "manage", sessionId: "session-1", sessionStatus: "in_progress" })).toBe("/sales?tab=sessions&sessionId=session-1&status=in_progress");
    expect(parseSalesWorkspaceRouteState({ tab: "sessions", view: "provision", sessionId: "session-1" })).toMatchObject({ tab: "sessions", sessionView: "provision", sessionId: "session-1" });
    expect(parseSalesWorkspaceRouteState({ tab: "sessions", sessionId: "session-1", status: "in_progress" })).toMatchObject({ tab: "sessions", sessionView: "manage", sessionId: "session-1", sessionStatus: "in_progress" });
  });

  it("opens Sales Support on the failure correlation thread", () => {
    expect(buildSalesWorkspaceHref({ tab: "support", correlationId: "corr-sales-429" })).toBe("/sales?tab=support&correlationId=corr-sales-429");
    expect(parseSalesWorkspaceRouteState({ tab: "support", correlationId: "corr-sales-429" })).toMatchObject({ tab: "support", correlationId: "corr-sales-429" });
  });
});
