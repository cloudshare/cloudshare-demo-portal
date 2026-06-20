import { describe, expect, it } from "vitest";
import {
  ADMIN_SESSION_EXPIRED_MESSAGE,
  ADMIN_TABS,
  beginLatestOnlyRequest,
  buildSupportWorkbenchQuery,
  buildWebhookCallbackUrl,
  getAdminTabLabel,
  getAllowedRegionValidationMessage,
  getExamAuthoringMode,
  getCompatibleRegions,
  isAdminSessionExpiredStatus,
  isLatestOnlyResponse,
  reconcileAllowedRegionIds,
  SUPPORT_WORKBENCH_DEFAULT_LIMIT,
  shouldShowCandidateProvisioning,
  shouldClearAdminBannerOnTabChange,
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
        "Project, Blueprint, and Snapshot are locked while editing a draft. Policy and allowed Regions can still be changed.",
    });
  });
});

describe("admin tab model", () => {
  it("treats Candidate provisioning as its own admin context", () => {
    expect(ADMIN_TABS).toContain("candidates");
    expect(ADMIN_TABS).toContain("monitoring");
    expect(getAdminTabLabel("candidates")).toBe("Candidates");
    expect(getAdminTabLabel("monitoring")).toBe("Session Monitoring");
    expect(getAdminTabLabel("support")).toBe("Support Workbench");
    expect(shouldShowCandidateProvisioning("candidates")).toBe(true);
    expect(shouldShowCandidateProvisioning("connection")).toBe(false);
    expect(shouldShowCandidateProvisioning("exams")).toBe(false);
    expect(shouldShowCandidateProvisioning("monitoring")).toBe(false);
    expect(shouldShowCandidateProvisioning("audit")).toBe(false);
    expect(shouldShowCandidateProvisioning("events")).toBe(false);
    expect(shouldShowCandidateProvisioning("support")).toBe(false);
    expect(shouldShowCandidateProvisioning("resources")).toBe(false);
  });

  it("clears dismissible admin banners only when changing tabs", () => {
    expect(shouldClearAdminBannerOnTabChange("candidates", "exams")).toBe(true);
    expect(shouldClearAdminBannerOnTabChange("candidates", "candidates")).toBe(false);
  });
});

describe("admin session expiry", () => {
  it("treats admin API 401 responses as expired sessions", () => {
    expect(isAdminSessionExpiredStatus(401)).toBe(true);
    expect(isAdminSessionExpiredStatus(403)).toBe(false);
    expect(isAdminSessionExpiredStatus(500)).toBe(false);
    expect(ADMIN_SESSION_EXPIRED_MESSAGE).toContain("session has expired");
  });
});

describe("webhook callback URL", () => {
  it("combines the public base URL and per-Customer webhook path", () => {
    expect(
      buildWebhookCallbackUrl(
        "https://example.trycloudflare.com/",
        "/api/webhooks/cloudshare/token-123",
      ),
    ).toBe("https://example.trycloudflare.com/api/webhooks/cloudshare/token-123");
  });

  it("returns null until both values are present", () => {
    expect(buildWebhookCallbackUrl("", "/api/webhooks/cloudshare/token-123")).toBeNull();
    expect(buildWebhookCallbackUrl("https://example.test", null)).toBeNull();
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

describe("support workbench filters", () => {
  it("builds a compact query string from non-default filter values", () => {
    expect(
      buildSupportWorkbenchQuery({
        candidate: "  morgan ",
        examId: "exam-1",
        status: "in_progress",
        scheduledFrom: "2026-06-20T00:00:00.000Z",
        scheduledTo: "2026-06-21T23:59:59.999Z",
        limit: "25",
      }),
    ).toBe(
      "?candidate=morgan&examId=exam-1&status=in_progress&scheduledFrom=2026-06-20T00%3A00%3A00.000Z&scheduledTo=2026-06-21T23%3A59%3A59.999Z&limit=25",
    );
  });

  it("omits blank values and the default limit from the support workbench query", () => {
    expect(
      buildSupportWorkbenchQuery({
        candidate: "",
        examId: "",
        status: "",
        scheduledFrom: "",
        scheduledTo: "",
        limit: String(SUPPORT_WORKBENCH_DEFAULT_LIMIT),
      }),
    ).toBe("");
  });
});
