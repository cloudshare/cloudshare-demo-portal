import { describe, expect, it } from "vitest";
import { SALES_TABS, buildSalesWorkspaceHref, getSalesTabLabel, parseSalesWorkspaceRouteState } from "./sales-shell-route";

describe("Sales workspace shell routes", () => {
  it("keeps Sessions first while exposing Trial Offerings as a first-class Sales section", () => {
    expect(SALES_TABS).toEqual(["sessions", "trial-offerings", "records", "items", "support"]);
    expect(SALES_TABS.map(getSalesTabLabel)).toEqual(["Sessions", "Trial Offerings", "Relationships", "Items", "Support"]);
    expect(parseSalesWorkspaceRouteState({})).toMatchObject({ tab: "sessions", itemView: "catalog" });
  });

  it("serialises Item authoring and detail routes without mixing Sales sections", () => {
    expect(buildSalesWorkspaceHref({ tab: "trial-offerings" })).toBe("/sales?tab=trial-offerings");
    expect(parseSalesWorkspaceRouteState({ tab: "trial-offerings" })).toMatchObject({ tab: "trial-offerings" });
    expect(buildSalesWorkspaceHref({ tab: "items", itemView: "edit", itemId: "item-1" })).toBe("/sales?tab=items&view=edit&itemId=item-1");
    expect(parseSalesWorkspaceRouteState({ tab: "items", view: "detail", itemId: "item-1" })).toMatchObject({ tab: "items", itemView: "detail", itemId: "item-1" });
    expect(buildSalesWorkspaceHref({ tab: "records", accountId: "account-1", opportunityId: "opportunity-1" })).toBe("/sales?tab=records&accountId=account-1&opportunityId=opportunity-1");
    expect(buildSalesWorkspaceHref({ tab: "sessions", opportunityId: "opportunity-1" })).toBe("/sales?tab=sessions&opportunityId=opportunity-1");
    expect(buildSalesWorkspaceHref({ tab: "sessions", queueView: "history", queueSearch: "Acme", queueSort: "name_asc", queueOffset: 25 })).toBe("/sales?tab=sessions&queue=history&q=Acme&sort=name_asc&offset=25");
    expect(buildSalesWorkspaceHref({ tab: "sessions", sessionView: "provision", sessionId: "session-1" })).toBe("/sales?tab=sessions&view=provision&sessionId=session-1");
    expect(buildSalesWorkspaceHref({ tab: "sessions", sessionView: "manage", sessionId: "session-1", sessionStatus: "in_progress", participantsOpen: true })).toBe("/sales?tab=sessions&sessionId=session-1&status=in_progress&participants=open");
    expect(parseSalesWorkspaceRouteState({ tab: "sessions", view: "provision", sessionId: "session-1" })).toMatchObject({ tab: "sessions", sessionView: "provision", sessionId: "session-1" });
    expect(parseSalesWorkspaceRouteState({ tab: "sessions", sessionId: "session-1", status: "in_progress", participants: "open" })).toMatchObject({ tab: "sessions", sessionView: "manage", sessionId: "session-1", sessionStatus: "in_progress", participantsOpen: true });
  });

  it("opens Sales Support on the failure correlation thread", () => {
    expect(buildSalesWorkspaceHref({ tab: "support", correlationId: "corr-sales-429" })).toBe("/sales?tab=support&correlationId=corr-sales-429");
    expect(parseSalesWorkspaceRouteState({ tab: "support", correlationId: "corr-sales-429" })).toMatchObject({ tab: "support", correlationId: "corr-sales-429" });
    expect(buildSalesWorkspaceHref({ tab: "support", source: "sales-trial-offerings", subjectId: "offering-1" })).toBe("/sales?tab=support&source=sales-trial-offerings&subjectId=offering-1");
    expect(parseSalesWorkspaceRouteState({ tab: "support", source: "sales-trial-offerings", subjectId: "offering-1" })).toMatchObject({ tab: "support", source: "sales-trial-offerings", subjectId: "offering-1" });
    expect(buildSalesWorkspaceHref({ tab: "support", operation: "cloudshare.request" })).toBe("/sales?tab=support&operation=cloudshare.request");
    expect(parseSalesWorkspaceRouteState({ tab: "support", operation: "cloudshare.request" })).toMatchObject({ tab: "support", operation: "cloudshare.request" });
  });

  it("keeps colliding IDs distinct by typed investigation subject", () => {
    expect(buildSalesWorkspaceHref({ tab: "support", subjectType: "sales_trial_offering", subjectId: "same-id" })).toBe("/sales?tab=support&subjectType=sales_trial_offering&subjectId=same-id");
    expect(buildSalesWorkspaceHref({ tab: "support", subjectType: "sales_trial_enrollment", subjectId: "same-id" })).toBe("/sales?tab=support&subjectType=sales_trial_enrollment&subjectId=same-id");
    expect(parseSalesWorkspaceRouteState({ tab: "support", subjectType: "sales_trial_enrollment", subjectId: "same-id" })).toMatchObject({ subjectType: "sales_trial_enrollment", subjectId: "same-id" });
  });
});
