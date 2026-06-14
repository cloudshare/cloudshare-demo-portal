import { describe, expect, it } from "vitest";
import { getExamAuthoringMode } from "./admin-console-state";

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
