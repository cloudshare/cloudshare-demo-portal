import { describe, expect, it } from "vitest";
import {
  getExpiredPortalLoginPath,
  getPortalReturnTargetForSession,
  getSafePortalTargetFromSearchParams,
} from "./portal-return-target";

describe("portal expired-session return targets", () => {
  it("keeps only safe GET targets in their matching workspace", () => {
    expect(getExpiredPortalLoginPath("/admin?tab=exams")).toBe("/login?returnTo=%2Fadmin%3Ftab%3Dexams");
    expect(getExpiredPortalLoginPath("/sales?tab=sessions&queueView=active")).toBe("/login?returnTo=%2Fsales%3Ftab%3Dsessions%26queueView%3Dactive");
    expect(getExpiredPortalLoginPath("/candidate")).toBe("/login?returnTo=%2Fcandidate");
    expect(getExpiredPortalLoginPath("/sales-trial")).toBe("/sales-trial/login?returnTo=%2Fsales-trial");
  });

  it("rejects external, credential-bearing, API, auth, mutation, and cross-workspace targets", () => {
    for (const target of [
      "https://attacker.invalid/",
      "//attacker.invalid/",
      "/api/admin/exams",
      "/login",
      "/enter",
      "/candidate/lab?examAttemptId=attempt-1",
      "/admin?tab=support&correlationId=protected",
      "/sales-trial?accessLink=secret",
      "/sales?tab=records&accountId=customer-2",
    ]) {
      expect(getExpiredPortalLoginPath(target)).toBeNull();
    }
  });

  it("reauthorizes the target after login and falls back to the role home", () => {
    expect(getPortalReturnTargetForSession({ role: "admin", workspace: "certification" }, "/admin?tab=exams")).toBe("/admin?tab=exams");
    expect(getPortalReturnTargetForSession({ role: "admin", workspace: "sales" }, "/sales?tab=sessions")).toBe("/sales?tab=sessions");
    expect(getPortalReturnTargetForSession({ role: "candidate" }, "/candidate")).toBe("/candidate");
    expect(getPortalReturnTargetForSession({ role: "sales_trial_participant" }, "/sales-trial")).toBe("/sales-trial");
    expect(getPortalReturnTargetForSession({ role: "admin", workspace: "sales" }, "/admin?tab=exams")).toBe("/sales");
    expect(getPortalReturnTargetForSession({ role: "candidate" }, "/sales")).toBe("/candidate");
  });

  it("preserves only an allowlisted server-rendered query string", () => {
    expect(getSafePortalTargetFromSearchParams("/admin", { tab: "exams" })).toBe("/admin?tab=exams");
    expect(getSafePortalTargetFromSearchParams("/sales", { tab: "sessions", queueView: "active" })).toBe("/sales?tab=sessions&queueView=active");
    expect(getSafePortalTargetFromSearchParams("/sales", { accountId: "another-customer" })).toBe("/sales");
  });
});
