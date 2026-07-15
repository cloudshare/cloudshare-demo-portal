import { describe, expect, it } from "vitest";
import { DEFAULT_SALES_SESSION_NAME_TEMPLATE, renderSalesSessionName } from "./sales-session-name";

describe("Sales Session name template", () => {
  it("renders the default Account - Opportunity (Revision) - Item template within CloudShare's bound", () => {
    expect(renderSalesSessionName(DEFAULT_SALES_SESSION_NAME_TEMPLATE, { account: "Helios CX", opportunity: "Renewal", revision: 2, item: "Accelerate" })).toBe("Helios CX - Renewal (2) - Accelerate");
  });
  it("rejects unbounded or revision-free templates", () => {
    expect(renderSalesSessionName("{account} {item}", { account: "A", opportunity: "O", revision: 1, item: "I" })).toBeNull();
  });
});
