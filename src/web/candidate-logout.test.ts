import { describe, expect, it } from "vitest";
import { getCandidateLogoutPresentation } from "./candidate-logout";

describe("candidate logout presentation", () => {
  it("makes a running logout visible and prevents repeat clicks", () => {
    expect(getCandidateLogoutPresentation({ pending: true, error: null })).toEqual({
      buttonLabel: "Logging out...",
      disabled: true,
      statusMessage: "Suspending any running lab before logging out...",
      errorMessage: null,
    });
  });

  it("shows a retry state when logout fails", () => {
    expect(getCandidateLogoutPresentation({ pending: false, error: "Logout failed (502)" })).toEqual({
      buttonLabel: "Try log out again",
      disabled: false,
      statusMessage: null,
      errorMessage: "Logout failed (502)",
    });
  });
});
