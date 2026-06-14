import { describe, expect, it } from "vitest";
import {
  beginLatestOnlyRequest,
  getExamAuthoringMode,
  isLatestOnlyResponse,
} from "./admin-console-state";

describe("latest-only request coordination", () => {
  it("increments the active request id for each new request", () => {
    expect(beginLatestOnlyRequest(0)).toBe(1);
    expect(beginLatestOnlyRequest(1)).toBe(2);
  });

  it("treats only the active request response as current", () => {
    expect(isLatestOnlyResponse(2, 2)).toBe(true);
    expect(isLatestOnlyResponse(2, 1)).toBe(false);
  });
});

describe("getExamAuthoringMode", () => {
  it("treats a new draft as fully editable", () => {
    expect(getExamAuthoringMode(null)).toEqual({
      isEditingDraft: false,
      provisioningLocked: false,
      tupleChangeHint: null,
    });
  });

  it("locks the provisioning tuple while editing an existing draft", () => {
    expect(getExamAuthoringMode("exam-1")).toEqual({
      isEditingDraft: true,
      provisioningLocked: true,
      tupleChangeHint:
        "Provisioning fields are locked while editing a draft. Cancel edit to choose a different project, blueprint, policy, or region.",
    });
  });
});
