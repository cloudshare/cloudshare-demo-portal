import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { AdminConsole } from "./admin-console";

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    replace: vi.fn(),
    refresh: vi.fn(),
  }),
}));

describe("AdminConsole", () => {
  it("renders Support Diagnostics as the primary support navigation label", () => {
    const html = renderToStaticMarkup(createElement(AdminConsole, { email: "admin@helioscx.demo" }));

    expect(html).toContain("Support Diagnostics");
    expect(html).not.toContain("Support Workbench");
    expect(html).toContain("Session Monitoring");
  });

  it("reopens on the Diagnostic Log tab when route state links to an ExamAttempt investigation", () => {
    const html = renderToStaticMarkup(
      createElement(AdminConsole, {
        email: "admin@helioscx.demo",
        initialTab: "diagnostics",
        initialDiagnosticFilters: {
          examAttemptId: "attempt-42",
          correlationId: "corr-42",
        },
      }),
    );

    expect(html).toContain("This is the primary support workflow.");
    expect(html).toContain("Filtered to ExamAttempt ID");
    expect(html).toContain("attempt-42");
    expect(html).toContain("Legacy/raw support traces");
  });
});
