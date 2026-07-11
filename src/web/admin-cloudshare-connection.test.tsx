import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  CloudShareConnectionFeature,
  CloudShareConnectionTestWarning,
} from "./admin-cloudshare-connection";
import {
  buildAdminNavigationHref,
  type AdminNavigationIntent,
} from "./admin-shell-route";

const shellNavigationHref = (intent: AdminNavigationIntent) => buildAdminNavigationHref(intent);

describe("CloudShareConnectionFeature", () => {
  it("renders the current credential setup workflow in Configuration", () => {
    const html = renderToStaticMarkup(
      createElement(CloudShareConnectionFeature, {
        fetchAdmin: vi.fn(),
        getNavigationHref: shellNavigationHref,
        onNavigate: vi.fn(),
      }),
    );

    expect(html).toContain("Save CloudShare Connection");
    expect(html).toContain("Test connection");
    expect(html).toContain("API ID");
  });

  it("renders a failed connection test with its Support Diagnostics link", () => {
    const html = renderToStaticMarkup(
      createElement(CloudShareConnectionTestWarning, {
        warning:
          "CloudShare is returning a 429 error for the current request. This is likely CloudShare rate limiting or abuse protection blocking the request. Check whether this public IP needs CloudShare allow-list or abuse-list review before retrying by contacting support@cloudshare.com.",
        correlationId: "corr-rate-limit",
        getNavigationHref: shellNavigationHref,
      }),
    );

    expect(html).toContain("CloudShare is returning a 429 error");
    expect(html).toContain("support@cloudshare.com");
    expect(html).toContain("public IP");
    expect(html).toContain("Support Diagnostics");
    expect(html).toContain("/admin?tab=support&amp;view=diagnostics&amp;correlationId=corr-rate-limit");
  });
});
