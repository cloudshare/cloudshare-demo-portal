import { describe, expect, it } from "vitest";
import { denialPage } from "@/web/sales-launch-denial-page";

describe("Certalis public launch denial page", () => {
  it("renders generic branded guidance and a sanitized support reference without bearer material", () => {
    const html = denialPage("corr-safe<script>provider-secret");
    expect(html).toContain("CERTALIS");
    expect(html).toContain("Launch link unavailable");
    expect(html).toContain("Contact your sales representative");
    expect(html).toContain("corr-safescriptprovider-secret");
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("/sales/launch/");
    expect(html).not.toContain("loginUrl");
  });
  it("renders escaped recovery contacts and authoritative invitation evidence only for known links", () => {
    const html = denialPage("corr-1", { salesPros: [{ name: "Owner <script>", email: "owner&team@example.test", type: "mainSalesPro" }, { name: "Extra", email: "extra@example.test", type: "salesPro" }], invitation: { status: "sent", invitedAt: "2026-07-18T09:05:00.000Z", invitedBy: "sender@example.test" } });
    expect(html).toContain("Main Sales Pro"); expect(html).toContain("Additional Sales Pro"); expect(html).toContain("Owner &lt;script&gt;"); expect(html).not.toContain("Owner <script>"); expect(html).toContain("Invitation sent at 2026-07-18T09:05:00.000Z by sender@example.test.");
    expect(denialPage("corr-2", { salesPros: [], invitation: { status: "sent", invitedAt: null, invitedBy: null } })).toContain("Invitation sent; sent time unavailable.");
    expect(denialPage("corr-3", { salesPros: [], invitation: { status: "notSent", invitedAt: null, invitedBy: null } })).toContain("No CloudShare invitation has been recorded as sent.");
  });
  it("renders an unnamed Sales Pro as a useful role-labelled email without inventing a name", () => {
    const html = denialPage("corr-4", { salesPros: [{ email: "owner@example.test", type: "mainSalesPro" }], invitation: { status: "notSent", invitedAt: null, invitedBy: null } });
    expect(html).toContain("owner@example.test"); expect(html).toContain("Main Sales Pro"); expect(html).not.toContain("undefined");
  });
});
