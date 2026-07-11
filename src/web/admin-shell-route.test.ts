import { describe, expect, it } from "vitest";
import {
  buildAdminNavigationHref,
  createExamAttemptDiagnosticsNavigationIntent,
} from "./admin-shell-route";

describe("admin shell navigation intents", () => {
  it("keeps an ExamAttempt investigation on the existing scoped Support Diagnostics URL", () => {
    const intent = createExamAttemptDiagnosticsNavigationIntent("  attempt-a  ");

    expect(intent).toEqual({
      tab: "support",
      supportView: "diagnostics",
      diagnosticFilters: { examAttemptId: "attempt-a" },
    });
    expect(buildAdminNavigationHref(intent)).toBe(
      "/admin?tab=support&view=diagnostics&examAttemptId=attempt-a",
    );
  });
});
