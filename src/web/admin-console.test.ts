import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { AdminConsole, ExamCatalogLoadingOverlay } from "./admin-console";

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

  it("renders an obvious active admin tab without the extra workflow context panel", () => {
    const html = renderToStaticMarkup(
      createElement(AdminConsole, {
        email: "admin@helioscx.demo",
        initialTab: "monitoring",
      }),
    );

    expect(html).toContain('aria-current="page"');
    expect(html).toContain("Session Monitoring");
    expect(html).toContain("Support Diagnostics");
    expect(html).not.toContain("Active workflow");
    expect(html).not.toContain("Monitor current ExamAttempt state, then open Support Diagnostics for the forensic trace.");
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
  });

  it("reopens on the Diagnostic Log tab when route state links from a correlation-based support action", () => {
    const html = renderToStaticMarkup(
      createElement(AdminConsole, {
        email: "admin@helioscx.demo",
        initialTab: "diagnostics",
        initialDiagnosticFilters: {
          correlationId: "corr-42",
        },
      }),
    );

    expect(html).toContain("This is the primary support workflow.");
    expect(html).toContain("Filtered to correlation ID");
    expect(html).toContain("corr-42");
  });

  it("renders diagnostics filters as a grouped investigative panel", () => {
    const html = renderToStaticMarkup(
      createElement(AdminConsole, {
        email: "admin@helioscx.demo",
        initialTab: "diagnostics",
      }),
    );

    expect(html).toContain("Investigative filters");
    expect(html).toContain("Investigation thread");
    expect(html).toContain("Event details");
    expect(html).toContain("Apply Filters");
    expect(html).toContain("Refresh Page");
  });

  it("renders the manually authored Exam open period field", () => {
    const html = renderToStaticMarkup(
      createElement(AdminConsole, {
        email: "admin@helioscx.demo",
        initialTab: "exams",
      }),
    );

    expect(html).toContain("Open period (minutes)");
    expect(html).toContain("CloudShare Experience duration from scheduled start");
    expect(html).toContain("defaults to the Policy runtime lease");
    expect(html).toContain("Time limit follows the selected CloudShare Policy runtime lease.");
    expect(html).not.toContain("defaults from Policy storage retention");
  });

  it("renders an Exam Catalog busy overlay that freezes the authoring surface while resources load", () => {
    const html = renderToStaticMarkup(createElement(ExamCatalogLoadingOverlay));

    expect(html).toContain('role="status"');
    expect(html).toContain("Loading Exam Catalog resources");
    expect(html).toContain("portal-spinner");
    expect(html).toContain("position:absolute");
    expect(html).toContain("inset:0");
    expect(html).toContain("flex-wrap:wrap");
    expect(html).toContain("max-width:min(100%, 22rem)");
  });

  it("renders Support Diagnostics without legacy workbench or support-log controls", () => {
    const html = renderToStaticMarkup(
      createElement(AdminConsole, {
        email: "admin@helioscx.demo",
        initialTab: "diagnostics",
      }),
    );

    expect(html).toContain("The correlated diagnostic log");
    expect(html).not.toContain("Legacy/raw support traces");
    expect(html).not.toContain("Load Recent Webhook Diagnostics");
    expect(html).not.toContain("Recent Webhook Diagnostics");
    expect(html).not.toContain("Load Full Support Log");
    expect(html).not.toContain("Support Log");
    expect(html).not.toContain("support-workbench");
  });
});
