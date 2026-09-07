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
    expect(getExpiredPortalLoginPath("/candidate?task=current&attemptId=attempt-1&examId=exam-1")).toBe("/login?returnTo=%2Fcandidate%3Ftask%3Dcurrent%26attemptId%3Dattempt-1%26examId%3Dexam-1");
    expect(getExpiredPortalLoginPath("/candidate?task=schedule&examId=exam-1")).toBe("/login?returnTo=%2Fcandidate%3Ftask%3Dschedule%26examId%3Dexam-1");
    expect(getExpiredPortalLoginPath("/sales-trial")).toBe("/sales-trial/login?returnTo=%2Fsales-trial");
    expect(getExpiredPortalLoginPath("/admin?tab=exams&delivery=cohort")).toBe("/login?returnTo=%2Fadmin%3Ftab%3Dexams%26delivery%3Dcohort");
    expect(getExpiredPortalLoginPath("/admin?tab=support&delivery=cohort")).toBe("/login?returnTo=%2Fadmin%3Ftab%3Dsupport%26delivery%3Dcohort");
    expect(getExpiredPortalLoginPath("/admin?tab=support&returnFocus=session-1&delivery=cohort")).toBe("/login?returnTo=%2Fadmin%3Ftab%3Dsupport%26delivery%3Dcohort");
  });

  it("rejects external, credential-bearing, API, auth, mutation, and cross-workspace targets", () => {
    for (const target of [
      "https://attacker.invalid/",
      "//attacker.invalid/",
      "/api/admin/exams",
      "/login",
      "/enter",
      "/candidate/lab?examAttemptId=attempt-1",
      "/candidate?task=history&attemptId=attempt-1&attemptId=attempt-2",
      "/candidate?task=schedule&attemptId=attempt-1",
      "/candidate?task=current&examId=exam-1",
      "/candidate?task=history&examId=exam-1",
      "/candidate?task=current&attemptId=bad%20id",
      "/candidate?task=current&attemptId=-attempt",
      "/candidate?task=current&attemptId=_attempt",
      "/admin?tab=support&correlationId=protected",
      "/sales-trial?accessLink=secret",
      "/sales?tab=records&accountId=customer-2",
      "/admin?tab=exams&view=edit",
      "/admin?tab=candidates&view=catalog",
      "/admin?tab=exams&delivery=unknown",
      "/admin?tab=support&view=diagnostics&delivery=cohort",
      "/sales?tab=items&view=provision",
      "/sales?tab=records&queue=history",
      "/sales?tab=sessions&view=provision&queue=history",
      "/sales?tab=sessions&view=provision&status=ended",
      "/sales?tab=sessions&queue=history&queue=active",
    ]) {
      expect(getExpiredPortalLoginPath(target)).toBeNull();
    }
  });

  it("reauthorizes the target after login and falls back to the role home", () => {
    expect(getPortalReturnTargetForSession({ role: "admin", workspace: "certification" }, "/admin?tab=exams")).toBe("/admin?tab=exams");
    expect(getPortalReturnTargetForSession({ role: "admin", workspace: "certification" }, "/admin?tab=exams&delivery=individual")).toBe("/admin?tab=exams&delivery=individual");
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

  it("rejects unverifiable dedicated Session resource routes", () => {
    expect(getExpiredPortalLoginPath("/sales/sessions/session-1?area=activity")).toBeNull();
    expect(getExpiredPortalLoginPath("/sales/sessions/session-1?area=activity&from=%2Fsales%3Ftab%3Dsessions")).toBeNull();
  });
});
