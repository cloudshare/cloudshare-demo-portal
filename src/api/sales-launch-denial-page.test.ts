import { describe, expect, it } from "vitest";
import { denialPage } from "../../app/sales/launch/[token]/route";

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
});
