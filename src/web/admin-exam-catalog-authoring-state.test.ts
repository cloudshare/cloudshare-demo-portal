import { describe, expect, it } from "vitest";
import {
  beginLatestOnlyRequest,
  getAllowedRegionValidationMessage,
  getCompatibleRegions,
  getDefaultOpenPeriodMinutes,
  getExamAuthoringMode,
  getResetOpenPeriodMinutes,
  isLatestOnlyResponse,
  reconcileAllowedRegionIds,
  shouldReconcileAllowedRegionIds,
} from "./admin-exam-catalog-authoring-state";

describe("Exam authoring request coordination", () => {
  it("increments the active request id for each new request", () => {
    expect(beginLatestOnlyRequest(0)).toBe(1);
    expect(beginLatestOnlyRequest(1)).toBe(2);
  });

  it("treats only the active request response as current", () => {
    expect(isLatestOnlyResponse(2, 2)).toBe(true);
    expect(isLatestOnlyResponse(2, 1)).toBe(false);
  });
});

describe("Exam authoring form state", () => {
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
        "Project, Blueprint, and Snapshot are locked while editing a draft. Policy and allowed Regions can still be changed.",
    });
  });

  it("defaults the open period from runtime lease, within storage evidence", () => {
    expect(getDefaultOpenPeriodMinutes({ runtimeLeaseMinutes: 90, storageLeaseMinutes: 2880 })).toBe("90");
    expect(getDefaultOpenPeriodMinutes({ storageLeaseMinutes: 2880 })).toBe("");
    expect(getDefaultOpenPeriodMinutes({ runtimeLeaseMinutes: 180, storageLeaseMinutes: 120 })).toBe("120");
  });

  it("retains an explicit or persisted open period during form reset", () => {
    expect(getResetOpenPeriodMinutes({
      explicitOpenPeriodMinutes: "720",
      selectedPolicy: { runtimeLeaseMinutes: 90, storageLeaseMinutes: 2880 },
    })).toBe("720");
    expect(getResetOpenPeriodMinutes({
      selectedPolicy: { runtimeLeaseMinutes: 120, storageLeaseMinutes: 1440 },
    })).toBe("120");
    expect(getResetOpenPeriodMinutes({ selectedPolicy: null, fallbackRuntimeLeaseMinutes: "90" })).toBe("90");
  });
});

describe("Exam authoring allowed Regions", () => {
  const regions = [
    { id: "region-1", name: "eu-west", friendlyName: "EU West" },
    { id: "region-2", name: "us-east", friendlyName: "US East" },
    { id: "region-3", name: "ap-south", friendlyName: "AP South" },
  ];

  it("limits allowed Regions to the default Snapshot deployment set", () => {
    const snapshot = { id: "snap-1", name: "Default Snapshot", isDefault: true, regionIds: ["region-1", "region-2"] };
    expect(getCompatibleRegions(regions, snapshot)).toEqual(regions.slice(0, 2));
    expect(getCompatibleRegions(regions, { ...snapshot, regionIds: [] })).toEqual([]);
  });

  it("reconciles Regions only after the default Snapshot is known", () => {
    const compatibleRegions = getCompatibleRegions(regions, {
      id: "snap-1", name: "Default Snapshot", isDefault: true, regionIds: ["region-2"],
    });
    expect(reconcileAllowedRegionIds(["region-1", "region-2"], compatibleRegions)).toEqual(["region-2"]);
    expect(shouldReconcileAllowedRegionIds(null)).toBe(false);
    expect(shouldReconcileAllowedRegionIds({ id: "snap-1", name: "Default Snapshot", isDefault: true, regionIds: ["region-1"] })).toBe(true);
  });

  it("requires a compatible allowed Region before an Exam can be saved", () => {
    expect(getAllowedRegionValidationMessage([], regions)).toBe(
      "Select at least one allowed Region from the Blueprint default Snapshot.",
    );
    expect(getAllowedRegionValidationMessage(["region-1"], [])).toBe(
      "The selected Blueprint default Snapshot is not deployed to any Regions yet.",
    );
    expect(getAllowedRegionValidationMessage(["region-1"], regions)).toBeNull();
  });
});
