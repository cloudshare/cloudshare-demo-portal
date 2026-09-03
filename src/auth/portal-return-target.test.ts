import { describe, expect, it } from "vitest";
import {
  getExpiredPortalLoginPath,
  getPortalReturnTargetForSession,
  getSafePortalTargetFromSearchParams,
} from "./portal-return-target";
import { buildAdminConsoleHref } from "../web/admin-shell-route";
import { buildSalesWorkspaceHref } from "../web/sales-shell-route";

describe("portal expired-session return targets", () => {
  it("keeps only safe GET targets in their matching workspace", () => {
    const adminAudit = buildAdminConsoleHref({ tab: "support", supportView: "audit" });
    const salesHistory = buildSalesWorkspaceHref({ tab: "sessions", queueView: "history", queueSort: "name_asc", queueOffset: 20 });
    expect(getExpiredPortalLoginPath(adminAudit)).toBe("/login?returnTo=%2Fadmin%3Ftab%3Dsupport%26view%3Daudit");
    expect(getExpiredPortalLoginPath(salesHistory)).toBe("/login?returnTo=%2Fsales%3Ftab%3Dsessions%26queue%3Dhistory%26sort%3Dname_asc%26offset%3D20");
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
    expect(getPortalReturnTargetForSession({ role: "admin", workspace: "sales" }, "/sales?tab=sessions&queue=history")).toBe("/sales?tab=sessions&queue=history");
    expect(getPortalReturnTargetForSession({ role: "candidate" }, "/candidate")).toBe("/candidate");
    expect(getPortalReturnTargetForSession({ role: "sales_trial_participant" }, "/sales-trial")).toBe("/sales-trial");
    expect(getPortalReturnTargetForSession({ role: "admin", workspace: "sales" }, "/admin?tab=exams")).toBe("/sales");
    expect(getPortalReturnTargetForSession({ role: "candidate" }, "/sales")).toBe("/candidate");
  });

  it("preserves only an allowlisted server-rendered query string", () => {
    expect(getSafePortalTargetFromSearchParams("/admin", { tab: "support", view: "audit" })).toBe("/admin?tab=support&view=audit");
    expect(getSafePortalTargetFromSearchParams("/sales", { tab: "sessions", queue: "history", sort: "name_asc", offset: "20" })).toBe("/sales?tab=sessions&queue=history&sort=name_asc&offset=20");
    expect(getSafePortalTargetFromSearchParams("/sales", { accountId: "another-customer" })).toBe("/sales");
  });
});
