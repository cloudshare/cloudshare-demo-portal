import { describe, expect, it } from "vitest";
import {
  beginLatestOnlyRequest,
  getAllowedRegionValidationMessage,
  getExamAuthoringMode,
  getCompatibleRegions,
  isLatestOnlyResponse,
  reconcileAllowedRegionIds,
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
        "Provisioning fields are locked while editing a draft. Cancel edit to choose a different project, blueprint, policy, or allowed Region set.",
    });
  });
});

describe("allowed Region selection state", () => {
  const regions = [
    { id: "region-1", name: "eu-west", friendlyName: "EU West" },
    { id: "region-2", name: "us-east", friendlyName: "US East" },
    { id: "region-3", name: "ap-south", friendlyName: "AP South" },
  ];

  it("filters compatible Regions to the default Snapshot deployment set", () => {
    expect(
      getCompatibleRegions(regions, {
        id: "snap-1",
        name: "Default Snapshot",
        isDefault: true,
        regionIds: ["region-1", "region-2"],
      }),
    ).toEqual([
      { id: "region-1", name: "eu-west", friendlyName: "EU West" },
      { id: "region-2", name: "us-east", friendlyName: "US East" },
    ]);
  });

  it("does not fall back to global Regions when the default Snapshot has no deployed Regions", () => {
    expect(
      getCompatibleRegions(regions, {
        id: "snap-1",
        name: "Default Snapshot",
        isDefault: true,
        regionIds: [],
      }),
    ).toEqual([]);
  });

  it("drops selected Regions that are no longer supported after a tuple change", () => {
    const compatibleRegions = getCompatibleRegions(regions, {
      id: "snap-1",
      name: "Default Snapshot",
      isDefault: true,
      regionIds: ["region-2"],
    });

    expect(reconcileAllowedRegionIds(["region-1", "region-2"], compatibleRegions)).toEqual([
      "region-2",
    ]);
  });

  it("requires at least one compatible Region before an exam can be saved", () => {
    expect(getAllowedRegionValidationMessage([], regions)).toBe(
      "Select at least one allowed Region from the Blueprint default Snapshot.",
    );
    expect(getAllowedRegionValidationMessage(["region-1"], [])).toBe(
      "The selected Blueprint default Snapshot is not deployed to any Regions yet.",
    );
    expect(getAllowedRegionValidationMessage(["region-1"], regions)).toBeNull();
  });
});
