"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import type { AdminAuthenticatedRequest } from "./admin-authenticated-request";
import { isAdminSessionExpiredError } from "./admin-authenticated-request";
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
} from "./admin-console-state";
import {
  createCorrelationDiagnosticsNavigationIntent,
  type AdminExamView,
  type AdminNavigationIntent,
} from "./admin-shell-route";
import { alertPanelStyle, cardStyle, mutedPanelStyle } from "./card-styles";
import { primaryButtonStyle, secondaryButtonStyle } from "./button-styles";
import { colors } from "./design-tokens";
import { formatAdminUtcTimestamp } from "./admin-attempt-presentation";
import { getExamStatusTone, statusBadgeStyle } from "./status-badge";

export interface NamedResource {
  readonly id: string;
  readonly name: string;
  readonly friendlyName?: string;
  readonly description?: string;
  readonly runtimeLeaseMinutes?: number | null;
  readonly storageLeaseMinutes?: number | null;
}

export interface BlueprintSnapshot {
  readonly id: string;
  readonly name: string;
  readonly isDefault: boolean;
  readonly regionIds: string[];
}

interface BlueprintDetail {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly defaultSnapshotId: string | null;
  readonly snapshots: BlueprintSnapshot[];
}

export interface ExamRecord {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly timeLimitMinutes: number;
  readonly storageLeaseMinutes?: number | null;
  readonly openPeriodMinutes: number;
  readonly scoreRetrievalEnabled: boolean;
  readonly deliveryAvailability?: "individual" | "cohort" | "both";
  readonly status: "draft" | "published" | "archived";
  readonly publishedAt: string | null;
  readonly archivedAt?: string | null;
  readonly createdAt?: string;
  readonly projectId: string;
  readonly projectName: string;
  readonly blueprintId: string;
  readonly blueprintName: string;
  readonly snapshotId: string;
  readonly snapshotName: string;
  readonly allowedRegions: Array<{ id: string; name: string }>;
  readonly policyId: string;
  readonly policyName: string;
  readonly instructorName: string;
}

interface ConnectionDiagnostic {
  readonly method: string;
  readonly path: string;
  readonly failureMode: string;
  readonly responseStatus?: number;
}

const busyShellStyle: React.CSSProperties = { position: "relative", overflow: "hidden" };
const overlayStyle: React.CSSProperties = {
  position: "absolute", inset: 0, zIndex: 2, display: "grid", alignItems: "flex-start",
  justifyItems: "center", minHeight: "18rem", padding: "1rem", boxSizing: "border-box",
  borderRadius: "8px", background: "rgba(248, 250, 252, 0.82)", backdropFilter: "blur(1px)",
};

export function ExamCatalogLoadingOverlay() {
  return (
    <div style={overlayStyle} aria-live="polite" aria-busy="true">
      <div role="status" style={{ ...cardStyle, display: "flex", alignItems: "center", gap: "0.75rem", flexWrap: "wrap", maxWidth: "min(100%, 22rem)", padding: "0.85rem 1rem" }}>
        <span className="portal-spinner" aria-hidden="true" style={{ width: "1.15rem", height: "1.15rem", borderRadius: "999px", border: `3px solid ${colors.borderStrong}`, borderTopColor: colors.accent, animation: "portal-spin 800ms linear infinite" }} />
        <span>Loading Exam Catalog resources</span>
      </div>
    </div>
  );
}

function stripHtmlToText(value: string | null | undefined): string {
  if (!value) return "";
  return value.replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ").replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/&#39;/gi, "'")
    .replace(/&quot;/gi, "\"").replace(/\s+/g, " ").trim();
}

export function formatShortExamId(id: string): string {
  return id.length <= 8 ? id : id.slice(0, 8);
}

function formatExamDeliveryAvailability(value: ExamRecord["deliveryAvailability"]): string {
  if (value === "cohort") return "Cohort Exam";
  if (value === "both") return "Individual + Cohort Exam";
  return "Individual Exam";
}

export function getDeliveryAvailabilityAuthoringOptions(value: ExamRecord["deliveryAvailability"]) {
  void value;
  return [
    { value: "individual", label: "Individual Exam", disabled: false },
    { value: "cohort", label: "Cohort Exam", disabled: false },
  ];
}

export function isCohortSessionAuthoringAvailable(value: ExamRecord["deliveryAvailability"]): boolean {
  return value === "cohort" || value === "both";
}

export function getDuplicateExamResourceTupleWarning(input: {
  readonly exams: readonly ExamRecord[];
  readonly currentExamId?: string | null;
  readonly projectId: string;
  readonly blueprintId: string;
  readonly snapshotId: string | null;
  readonly policyId: string;
  readonly deliveryAvailability: ExamRecord["deliveryAvailability"];
}): string | null {
  const snapshotId = input.snapshotId ?? "";
  if (!input.projectId || !input.blueprintId || !snapshotId || !input.policyId) return null;
  const duplicate = input.exams.find((exam) =>
    exam.id !== input.currentExamId && exam.projectId === input.projectId &&
    exam.blueprintId === input.blueprintId && exam.snapshotId === snapshotId &&
    exam.policyId === input.policyId && (exam.deliveryAvailability ?? "individual") === input.deliveryAvailability,
  );
  return duplicate
    ? `Another Exam already uses this Project, Blueprint, default Snapshot, Policy, and delivery mode: ${duplicate.title} (${formatShortExamId(duplicate.id)}). Confirm the Exam title and delivery scope before saving.`
    : null;
}

export function ExamAuthoringSelectionSummary(props: {
  readonly selectedProject: NamedResource | null;
  readonly selectedBlueprint: NamedResource | null;
  readonly defaultSnapshot: BlueprintSnapshot | null;
  readonly selectedAllowedRegions: readonly NamedResource[];
  readonly selectedPolicy: NamedResource | null;
  readonly deliveryAvailability: ExamRecord["deliveryAvailability"];
  readonly duplicateExamResourceTupleWarning?: string | null;
}) {
  const policy = [
    props.selectedPolicy?.name ?? "-",
    props.selectedPolicy?.runtimeLeaseMinutes ? `${props.selectedPolicy.runtimeLeaseMinutes} minute runtime lease` : null,
    props.selectedPolicy?.storageLeaseMinutes ? `${props.selectedPolicy.storageLeaseMinutes} minute storage retention` : null,
  ].filter(Boolean).join(" · ");
  const row = (label: string, value: string) => <div style={{ color: "#444", fontSize: "0.9rem", overflowWrap: "anywhere" }}>{label}: {value}</div>;
  return <div style={{ display: "grid", gap: "0.5rem", padding: "0.85rem 1rem", border: "1px solid #e5e7eb", borderRadius: "6px", background: "#fafafa" }}>
    <strong>Selection summary</strong>
    {row("Project", props.selectedProject?.name ?? "-")}
    {row("Blueprint", props.selectedBlueprint?.name ?? "-")}
    {row("Snapshot", props.defaultSnapshot ? `${props.defaultSnapshot.name} (default only for Experience launches)` : "-")}
    {row("Allowed Regions", props.selectedAllowedRegions.length ? props.selectedAllowedRegions.map((r) => r.friendlyName ?? r.name).join(", ") : "-")}
    {row("Policy", policy)}
    {row("Delivery", formatExamDeliveryAvailability(props.deliveryAvailability))}
    {props.duplicateExamResourceTupleWarning ? <div role="status" style={{ color: "#7a4b00", background: "#fff7e6", border: "1px solid #f0d38a", borderRadius: "6px", padding: "0.7rem 0.85rem" }}>{props.duplicateExamResourceTupleWarning}</div> : null}
  </div>;
}

export function ExamCatalogRowActions(props: {
  readonly exam: Pick<ExamRecord, "id" | "status" | "deliveryAvailability">;
  readonly loading: boolean;
  readonly editingExamId: string | null;
  readonly hasActiveCohortSessions?: boolean;
  readonly onEdit: () => void;
  readonly onPublish: () => void;
  readonly onUnpublish: () => void;
  readonly onArchive?: () => void;
  readonly onManageCohortSessions: () => void;
}) {
  const cohort = isCohortSessionAuthoringAvailable(props.exam.deliveryAvailability);
  const cohortOnly = props.exam.deliveryAvailability === "cohort";
  return <div style={{ display: "grid", gap: "0.5rem" }}>
    <div style={{ color: colors.textSecondary, fontSize: "0.8rem" }}>Delivery: {formatExamDeliveryAvailability(props.exam.deliveryAvailability)}</div>
    {cohort ? <button type="button" onClick={props.onManageCohortSessions} disabled={props.loading} style={{ padding: "0.45rem 0.75rem" }}>Manage Cohort Sessions</button> : null}
    {cohortOnly && props.exam.status === "published" ? <div>
      <button onClick={props.onArchive} disabled={props.loading || props.editingExamId !== null || Boolean(props.hasActiveCohortSessions)} title={props.hasActiveCohortSessions ? "Retire all Cohort Exam Sessions before archiving this Exam." : undefined} style={{ padding: "0.45rem 0.75rem" }}>Archive Exam</button>
      {props.hasActiveCohortSessions ? <span style={{ color: colors.textSecondary, fontSize: "0.85rem", marginLeft: "0.5rem" }}>Retire all Cohort Exam Sessions first.</span> : null}
    </div> : cohortOnly ? <div style={{ color: colors.textSecondary, fontSize: "0.85rem" }}><div>Exam setup is {props.exam.status}</div><div>Publish the individual Cohort Sessions after opening this Exam.</div></div>
    : props.exam.status === "draft" ? <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
      {props.editingExamId === props.exam.id ? <span style={{ color: colors.textSecondary, fontSize: "0.85rem" }}>Editing - save or cancel before publishing.</span> : <><button onClick={props.onEdit} disabled={props.loading || props.editingExamId !== null} style={{ padding: "0.45rem 0.75rem" }}>Edit Exam</button><button onClick={props.onPublish} disabled={props.loading || props.editingExamId !== null} style={{ padding: "0.45rem 0.75rem" }}>Publish Exam</button></>}
    </div> : props.exam.status === "published" ? <div style={{ display: "flex", gap: "0.5rem" }}><button onClick={props.onUnpublish} disabled={props.loading || props.editingExamId !== null} style={{ padding: "0.45rem 0.75rem" }}>Unpublish Exam</button><button onClick={props.onArchive} disabled={props.loading || props.editingExamId !== null} style={{ padding: "0.45rem 0.75rem" }}>Archive Exam</button></div>
    : <span style={{ color: colors.textSecondary, fontSize: "0.85rem" }}>Archived for history and support review.</span>}
  </div>;
}

export interface AdminExamCatalogAuthoringFeatureProps {
  readonly active: boolean;
  readonly examView: AdminExamView;
  readonly focusedExamId: string | null;
  readonly fetchAdmin: AdminAuthenticatedRequest;
  readonly onNavigate: (intent: AdminNavigationIntent) => void;
  readonly onCatalogChange: (catalog: { readonly activeExams: readonly ExamRecord[]; readonly archivedExams: readonly ExamRecord[] }) => void;
  readonly getHasActiveCohortSessions: (examId: string) => boolean;
}

export function AdminExamCatalogAuthoringFeature(props: AdminExamCatalogAuthoringFeatureProps) {
  const [projects, setProjects] = useState<NamedResource[]>([]);
  const [regions, setRegions] = useState<NamedResource[]>([]);
  const [blueprints, setBlueprints] = useState<NamedResource[]>([]);
  const [policies, setPolicies] = useState<NamedResource[]>([]);
  const [blueprintDetail, setBlueprintDetail] = useState<BlueprintDetail | null>(null);
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [selectedBlueprintId, setSelectedBlueprintId] = useState("");
  const [selectedPolicyId, setSelectedPolicyId] = useState("");
  const [selectedAllowedRegionIds, setSelectedAllowedRegionIds] = useState<string[]>([]);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [openPeriodMinutes, setOpenPeriodMinutes] = useState("");
  const [scoreRetrievalEnabled, setScoreRetrievalEnabled] = useState(false);
  const [deliveryAvailability, setDeliveryAvailability] = useState<"individual" | "cohort" | "both">("individual");
  const [editingExamId, setEditingExamId] = useState<string | null>(null);
  const [activeExams, setActiveExams] = useState<ExamRecord[]>([]);
  const [archivedExams, setArchivedExams] = useState<ExamRecord[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [correlationId, setCorrelationId] = useState<string | null>(null);
  const [diagnostic, setDiagnostic] = useState<ConnectionDiagnostic | null>(null);
  const [loading, setLoading] = useState(false);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const projectRequestRef = useRef(0);
  const blueprintRequestRef = useRef(0);
  const catalogLoadingCountRef = useRef(0);
  const allExams = useMemo(() => [...activeExams, ...archivedExams], [activeExams, archivedExams]);
  const selectedProject = projects.find((item) => item.id === selectedProjectId) ?? null;
  const selectedBlueprint = blueprints.find((item) => item.id === selectedBlueprintId) ?? null;
  const selectedPolicy = policies.find((item) => item.id === selectedPolicyId) ?? null;
  const defaultSnapshot = blueprintDetail?.snapshots.find((item) => item.id === blueprintDetail.defaultSnapshotId) ?? null;
  const compatibleRegions = getCompatibleRegions(regions, defaultSnapshot);
  const selectedAllowedRegions = compatibleRegions.filter((region) => selectedAllowedRegionIds.includes(region.id));
  const allowedRegionValidationMessage = getAllowedRegionValidationMessage(selectedAllowedRegionIds, compatibleRegions);
  const authoringMode = getExamAuthoringMode(editingExamId);

  function navigateCatalog() {
    setEditingExamId(null);
    props.onNavigate({ tab: "exams", examView: "catalog" });
  }

  function selectProject(nextProjectId: string) {
    setSelectedProjectId(nextProjectId);
    setEditingExamId(null);
    setSelectedBlueprintId("");
    setBlueprintDetail(null);
    void loadProjectResources(nextProjectId, true);
  }

  function selectBlueprint(nextBlueprintId: string) {
    setSelectedBlueprintId(nextBlueprintId);
    setEditingExamId(null);
    setFeedback(null);
    setOpenPeriodMinutes(getDefaultOpenPeriodMinutes(selectedPolicy));
    if (selectedProjectId && nextBlueprintId) {
      void loadBlueprintDetail(selectedProjectId, nextBlueprintId, true);
    }
  }

  function selectPolicy(nextPolicyId: string) {
    const nextPolicy = policies.find((policy) => policy.id === nextPolicyId);
    setSelectedPolicyId(nextPolicyId);
    setFeedback(null);
    setOpenPeriodMinutes(getDefaultOpenPeriodMinutes(nextPolicy));
  }

  function beginCatalogLoading() {
    catalogLoadingCountRef.current += 1;
    setCatalogLoading(true);
  }

  function endCatalogLoading() {
    catalogLoadingCountRef.current = Math.max(0, catalogLoadingCountRef.current - 1);
    setCatalogLoading(catalogLoadingCountRef.current > 0);
  }

  async function loadBlueprintDetail(projectId: string, blueprintId: string, refresh = false, policyForDefault = selectedPolicy) {
    const requestId = beginLatestOnlyRequest(blueprintRequestRef.current);
    blueprintRequestRef.current = requestId;
    setLoading(true); beginCatalogLoading(); setError(null); setCorrelationId(null); setDiagnostic(null);
    try {
      const response = await props.fetchAdmin(`/api/admin/exam-authoring/projects/${encodeURIComponent(projectId)}/blueprints/${encodeURIComponent(blueprintId)}${refresh ? "?refresh=true" : ""}`);
      const data = await response.json() as { blueprint?: BlueprintDetail; error?: string; correlationId?: string | null; diagnostic?: ConnectionDiagnostic };
      if (!isLatestOnlyResponse(blueprintRequestRef.current, requestId)) return;
      if (!response.ok) { setError(data.error ?? "Failed to load blueprint detail"); setCorrelationId(data.correlationId ?? null); setDiagnostic(data.diagnostic ?? null); return; }
      const detail = data.blueprint ?? null;
      setBlueprintDetail(detail);
      if (!editingExamId && props.examView !== "edit" && detail) {
        setTitle(detail.name); setDescription(stripHtmlToText(detail.description)); setOpenPeriodMinutes(getDefaultOpenPeriodMinutes(policyForDefault));
      }
    } catch (caught) {
      if (!isAdminSessionExpiredError(caught) && isLatestOnlyResponse(blueprintRequestRef.current, requestId)) setError("Failed to load blueprint detail");
    } finally { setLoading(false); endCatalogLoading(); }
  }

  async function loadProjectResources(projectId: string, refresh = false, preferredBlueprintId?: string, preferredPolicyId?: string) {
    const requestId = beginLatestOnlyRequest(projectRequestRef.current);
    projectRequestRef.current = requestId;
    setLoading(true); beginCatalogLoading(); setError(null); setCorrelationId(null); setDiagnostic(null);
    try {
      const response = await props.fetchAdmin(`/api/admin/exam-authoring/projects/${encodeURIComponent(projectId)}${refresh ? "?refresh=true" : ""}`);
      const data = await response.json() as { blueprints?: NamedResource[]; policies?: NamedResource[]; error?: string; correlationId?: string | null; diagnostic?: ConnectionDiagnostic };
      if (!isLatestOnlyResponse(projectRequestRef.current, requestId)) return;
      if (!response.ok) { setError(data.error ?? "Failed to load project resources"); setCorrelationId(data.correlationId ?? null); setDiagnostic(data.diagnostic ?? null); return; }
      const nextBlueprints = data.blueprints ?? []; const nextPolicies = data.policies ?? [];
      setBlueprints(nextBlueprints); setPolicies(nextPolicies);
      const nextPolicyId = nextPolicies.some((policy) => policy.id === (preferredPolicyId ?? selectedPolicyId)) ? (preferredPolicyId ?? selectedPolicyId) : (nextPolicies[0]?.id ?? "");
      const policy = nextPolicies.find((item) => item.id === nextPolicyId);
      setSelectedPolicyId(nextPolicyId);
      const nextBlueprintId = nextBlueprints.some((blueprint) => blueprint.id === (preferredBlueprintId ?? selectedBlueprintId)) ? (preferredBlueprintId ?? selectedBlueprintId) : (nextBlueprints[0]?.id ?? "");
      setSelectedBlueprintId(nextBlueprintId);
      if (!editingExamId && props.examView !== "edit") setOpenPeriodMinutes(getDefaultOpenPeriodMinutes(policy));
      if (nextBlueprintId) await loadBlueprintDetail(projectId, nextBlueprintId, refresh, policy);
      else setBlueprintDetail(null);
    } catch (caught) {
      if (!isAdminSessionExpiredError(caught) && isLatestOnlyResponse(projectRequestRef.current, requestId)) setError("Failed to load project resources");
    } finally { setLoading(false); endCatalogLoading(); }
  }

  async function loadAuthoring(refresh = false) {
    setLoading(true); beginCatalogLoading(); setError(null); setCorrelationId(null); setDiagnostic(null);
    try {
      const response = await props.fetchAdmin(`/api/admin/exam-authoring${refresh ? "?refresh=true" : ""}`);
      const data = await response.json() as { projects?: NamedResource[]; regions?: NamedResource[]; error?: string; correlationId?: string | null; diagnostic?: ConnectionDiagnostic };
      if (!response.ok) { setError(data.error ?? "Failed to load exam authoring resources"); setCorrelationId(data.correlationId ?? null); setDiagnostic(data.diagnostic ?? null); return; }
      const nextProjects = data.projects ?? []; setProjects(nextProjects); setRegions(data.regions ?? []);
      const nextProjectId = nextProjects.some((project) => project.id === selectedProjectId) ? selectedProjectId : (nextProjects[0]?.id ?? "");
      setSelectedProjectId(nextProjectId);
      if (nextProjectId && !selectedProjectId) await loadProjectResources(nextProjectId, true);
    } catch (caught) { if (!isAdminSessionExpiredError(caught)) setError("Failed to load exam authoring resources"); }
    finally { setLoading(false); endCatalogLoading(); }
  }

  async function loadCatalog() {
    beginCatalogLoading();
    try {
      const response = await props.fetchAdmin("/api/admin/exams");
      const data = await response.json() as { activeExams?: ExamRecord[]; archivedExams?: ExamRecord[]; error?: string };
      if (!response.ok) { setError(data.error ?? "Failed to load exam catalog"); return; }
      const active = data.activeExams ?? []; const archived = data.archivedExams ?? [];
      setActiveExams(active); setArchivedExams(archived); props.onCatalogChange({ activeExams: active, archivedExams: archived });
    } catch (caught) { if (!isAdminSessionExpiredError(caught)) setError("Failed to load exam catalog"); }
    finally { endCatalogLoading(); }
  }

  function resetForm(next?: Partial<Pick<ExamRecord, "title" | "description" | "scoreRetrievalEnabled" | "deliveryAvailability" | "openPeriodMinutes">>) {
    setEditingExamId(null); setMessage(null); setFeedback(null);
    setTitle(next?.title ?? blueprintDetail?.name ?? ""); setDescription(next?.description ?? stripHtmlToText(blueprintDetail?.description));
    setScoreRetrievalEnabled(next?.scoreRetrievalEnabled ?? false); setDeliveryAvailability(next?.deliveryAvailability ?? "individual");
    setOpenPeriodMinutes(getResetOpenPeriodMinutes({ explicitOpenPeriodMinutes: next?.openPeriodMinutes?.toString(), selectedPolicy }));
  }

  async function editExam(exam: ExamRecord) {
    setLoading(true); setError(null); setMessage(null); setEditingExamId(exam.id);
    setSelectedProjectId(exam.projectId); setSelectedAllowedRegionIds(exam.allowedRegions.map((region) => region.id));
    await loadProjectResources(exam.projectId, false, exam.blueprintId, exam.policyId);
    setSelectedBlueprintId(exam.blueprintId); setSelectedPolicyId(exam.policyId);
    await loadBlueprintDetail(exam.projectId, exam.blueprintId, false);
    setTitle(exam.title); setDescription(exam.description); setScoreRetrievalEnabled(exam.scoreRetrievalEnabled); setDeliveryAvailability(exam.deliveryAvailability ?? "individual"); setOpenPeriodMinutes(String(exam.openPeriodMinutes));
    props.onNavigate({ tab: "exams", examView: "edit", examId: exam.id }); setLoading(false);
  }

  async function saveDraft() {
    setLoading(true); setError(null); setMessage(null); setFeedback(null);
    const project = selectedProject; const blueprint = selectedBlueprint; const policy = selectedPolicy; const snapshot = defaultSnapshot;
    const parsedOpenPeriod = Number(openPeriodMinutes); const validation = getAllowedRegionValidationMessage(selectedAllowedRegionIds, compatibleRegions);
    const fail = (text: string) => { setError(text); setFeedback(text); };
    try {
      if (validation) return fail(validation);
      if (!project || !blueprint || !policy || !snapshot || !policy.runtimeLeaseMinutes) return fail("Select a project, blueprint, policy, and allowed Region set before saving the Exam.");
      if (!Number.isInteger(parsedOpenPeriod) || parsedOpenPeriod <= 0) return fail("Open period must be a positive whole number of minutes.");
      if (parsedOpenPeriod < policy.runtimeLeaseMinutes) return fail("Open period must be at least the Policy runtime lease.");
      if (policy.storageLeaseMinutes != null && parsedOpenPeriod > policy.storageLeaseMinutes) return fail("Open period must not exceed the Policy storage lease.");
      const response = await props.fetchAdmin(editingExamId ? `/api/admin/exams/${encodeURIComponent(editingExamId)}` : "/api/admin/exams", {
        method: editingExamId ? "PATCH" : "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ title, description, scoreRetrievalEnabled, deliveryAvailability, allowedRegionIds: selectedAllowedRegionIds, policyId: policy.id, openPeriodMinutes: parsedOpenPeriod, ...(editingExamId ? {} : { projectId: project.id, projectName: project.name, blueprintId: blueprint.id, blueprintName: blueprint.name, snapshotId: snapshot.id, snapshotName: snapshot.name, policyName: policy.name }) }),
      });
      const data = await response.json() as { error?: string };
      if (!response.ok) return fail(data.error ?? "Failed to save draft exam");
      setMessage(editingExamId ? "Draft exam updated." : "Draft exam saved."); resetForm(); await loadCatalog(); navigateCatalog();
    } catch (caught) { if (!isAdminSessionExpiredError(caught)) fail("Failed to save draft exam"); }
    finally { setLoading(false); }
  }

  async function lifecycle(examId: string, action: "publish" | "unpublish" | "archive", confirmed = false) {
    setLoading(true); setError(null); setMessage(null);
    try {
      const response = await props.fetchAdmin(`/api/admin/exams/${encodeURIComponent(examId)}/${action}`, action === "archive" ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(confirmed ? { confirmArchive: true } : {}) } : { method: "POST" });
      const data = await response.json() as { error?: string; code?: string; warning?: { scheduledAttemptCount?: number; activeAttemptCount?: number } };
      if (response.status === 409 && data.code === "confirmation_required" && action === "archive" && !confirmed) {
        if (window.confirm(`Archive this Exam? ${data.warning?.scheduledAttemptCount ?? 0} scheduled attempt(s) and ${data.warning?.activeAttemptCount ?? 0} active attempt(s) still rely on it.`)) await lifecycle(examId, action, true);
        return;
      }
      if (!response.ok) { setError(data.error ?? `Failed to ${action} exam`); return; }
      setMessage(action === "publish" ? "Exam published." : action === "unpublish" ? "Exam returned to draft." : "Exam archived."); await loadCatalog();
    } catch (caught) { if (!isAdminSessionExpiredError(caught)) setError(`Failed to ${action} exam`); }
    finally { setLoading(false); }
  }

  useEffect(() => {
    if (props.active) {
      void loadCatalog();
      if (props.examView === "create" || props.examView === "edit") void loadAuthoring();
    }
    // Feature loading is driven by the stable shell adapter and route activation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.active, props.examView]);
  useEffect(() => {
    if (!props.active || props.examView !== "edit" || !props.focusedExamId || editingExamId === props.focusedExamId) return;
    const exam = allExams.find((item) => item.id === props.focusedExamId); if (exam) void editExam(exam);
    // Route/catalog changes drive deep-link edit hydration; the function closes over feature state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.active, props.examView, props.focusedExamId, allExams, editingExamId]);
  useEffect(() => {
    if (!shouldReconcileAllowedRegionIds(defaultSnapshot)) return;
    const next = reconcileAllowedRegionIds(selectedAllowedRegionIds, compatibleRegions);
    if (next.length !== selectedAllowedRegionIds.length) setSelectedAllowedRegionIds(next);
  }, [defaultSnapshot, compatibleRegions, selectedAllowedRegionIds]);

  if (!props.active) return null;
  const authoring = props.examView === "create" || props.examView === "edit";
  const effectiveTime = selectedPolicy?.runtimeLeaseMinutes ?? "";
  const duplicateWarning = getDuplicateExamResourceTupleWarning({ exams: allExams, currentExamId: editingExamId, projectId: selectedProjectId, blueprintId: selectedBlueprintId, snapshotId: defaultSnapshot?.id ?? null, policyId: selectedPolicyId, deliveryAvailability });
  const compactFieldStyle = {
    padding: "0.7rem", paddingRight: "2.25rem", border: "1px solid #ccc", borderRadius: "6px",
    width: "100%", boxSizing: "border-box", minWidth: 0, minHeight: "46px",
  } as const;
  return <section aria-busy={catalogLoading} style={{ ...busyShellStyle, display: "grid", gap: "1rem" }}>
    {catalogLoading ? <ExamCatalogLoadingOverlay /> : null}
    {error ? <div role="alert" style={{ ...alertPanelStyle.danger, display: "grid", gap: "0.5rem" }}><div style={{ display: "flex", justifyContent: "space-between", gap: "1rem", alignItems: "flex-start" }}><p style={{ margin: 0 }}>{error}</p><button type="button" onClick={() => { setError(null); setCorrelationId(null); }} style={{ padding: "0.25rem 0.55rem" }}>Dismiss</button></div>{correlationId ? <p style={{ margin: 0, fontSize: "0.85rem" }}>Open <strong>Support Diagnostics</strong> filtered by correlation ID <button type="button" onClick={() => props.onNavigate(createCorrelationDiagnosticsNavigationIntent(correlationId))} style={{ color: colors.info, fontFamily: "monospace", fontWeight: 700, overflowWrap: "anywhere", border: 0, padding: 0, background: "transparent", cursor: "pointer" }}>{correlationId}</button>.</p> : null}</div> : null}
    <div style={{ ...mutedPanelStyle, display: "grid", gap: "0.75rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: "1rem", flexWrap: "wrap", alignItems: "center" }}>
        <div><h2 style={{ margin: 0 }}>Exam Catalog</h2><p style={{ margin: "0.25rem 0 0", color: colors.textSecondary }}>Overview of Exams and delivery options for Helios CX.</p></div>
          {props.examView !== "sessions" && props.examView !== "session" ? <button type="button" onClick={() => { resetForm(); props.onNavigate({ tab: "exams", examView: "create" }); }} disabled={loading} style={primaryButtonStyle}>Create Exam</button> : null}
      </div>
      <nav aria-label="Exam workspace"><ol style={{ display: "flex", gap: "0.45rem", margin: 0, padding: 0, listStyle: "none" }}><li>{props.examView === "catalog" ? <span aria-current="page">Catalog overview</span> : <button type="button" onClick={navigateCatalog} style={secondaryButtonStyle}>Catalog overview</button>}</li>{authoring ? <li aria-current="page">{props.examView === "edit" ? "Edit Exam" : "Create Exam"}</li> : null}</ol></nav>
    </div>
    {authoring ? <><div style={{ padding: "1rem", background: "#f7f7f8", borderRadius: "6px", display: "grid", gap: "0.5rem" }}><strong>Project-first Exam authoring</strong><span style={{ color: "#555" }}>Regions are global reference data. Blueprints and Policies are fetched in the selected Project context. For experience-based Exams, CloudShare launches always use the Blueprint&apos;s current default snapshot.</span><span style={{ color: "#555" }}>Instructor choice is fixed to the seeded CloudShare service account for this slice and must be explicitly configured before an Exam can be saved.</span><div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}><button onClick={() => void loadAuthoring(true)} disabled={loading}>{loading ? "Loading..." : "Refresh Projects & Regions"}</button>{selectedProjectId ? <button onClick={() => void loadProjectResources(selectedProjectId, true)} disabled={loading}>{loading ? "Loading..." : "Refresh Selected Project"}</button> : null}</div>{authoringMode.tupleChangeHint ? <span style={{ color: "#555" }}>{authoringMode.tupleChangeHint}</span> : null}</div>
      {diagnostic ? <div style={alertPanelStyle.warning}>CloudShare resource request failed. {diagnostic.method} {diagnostic.path} · {diagnostic.failureMode}{diagnostic.responseStatus ? ` · HTTP ${diagnostic.responseStatus}` : ""}</div> : null}
      <div style={{ display: "grid", gap: "0.75rem", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", alignItems: "start" }}>
        <label style={{ display: "grid", gap: "0.35rem", minWidth: 0 }}>Project<select value={selectedProjectId} onChange={(e) => selectProject(e.target.value)} disabled={authoringMode.provisioningLocked} style={compactFieldStyle}><option value="">Select a Project</option>{projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label>
        <label style={{ display: "grid", gap: "0.35rem", minWidth: 0 }}>Blueprint<select value={selectedBlueprintId} onChange={(e) => selectBlueprint(e.target.value)} disabled={authoringMode.provisioningLocked} style={compactFieldStyle}><option value="">Select a Blueprint</option>{blueprints.map((blueprint) => <option key={blueprint.id} value={blueprint.id}>{blueprint.name}</option>)}</select></label>
        <label style={{ display: "grid", gap: "0.35rem", minWidth: 0 }}>Snapshot<div title={defaultSnapshot ? `${defaultSnapshot.name} (default)` : "Select a Blueprint"} style={{ ...compactFieldStyle, background: "#f9fafb", color: defaultSnapshot ? "#111" : "#666", fontSize: "0.95rem", lineHeight: "1.2", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{defaultSnapshot ? `${defaultSnapshot.name} (default)` : "Select a Blueprint"}</div></label>
        <label style={{ display: "grid", gap: "0.35rem", minWidth: 0 }}>Policy<select value={selectedPolicyId} onChange={(e) => selectPolicy(e.target.value)} style={compactFieldStyle}><option value="">Select a Policy</option>{policies.map((policy) => <option key={policy.id} value={policy.id}>{policy.name}</option>)}</select></label>
        <label style={{ display: "grid", gap: "0.35rem", minWidth: 0 }}>Allowed Regions<div style={{ ...compactFieldStyle, background: "#fff", display: "grid", gap: "0.5rem", paddingRight: "0.7rem" }}>{compatibleRegions.length === 0 ? <span style={{ color: "#666" }}>No deployed Regions found for the current default Snapshot.</span> : compatibleRegions.map((region) => <label key={region.id} style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}><input type="checkbox" checked={selectedAllowedRegionIds.includes(region.id)} onChange={(e) => setSelectedAllowedRegionIds((current) => e.target.checked ? [...current, region.id] : current.filter((id) => id !== region.id))} /><span>{region.friendlyName ?? region.name}</span></label>)}</div>{allowedRegionValidationMessage ? <span style={{ color: "#b42318", fontSize: "0.85rem" }}>{allowedRegionValidationMessage}</span> : null}</label>
        <label style={{ display: "grid", gap: "0.35rem", gridColumn: "1 / -1" }}>Exam title<input value={title} onChange={(e) => setTitle(e.target.value)} style={{ padding: "0.7rem", border: "1px solid #ccc", borderRadius: "6px" }} /></label>
        <label style={{ display: "grid", gap: "0.35rem", gridColumn: "1 / -1" }}>Description<textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={4} style={{ padding: "0.7rem", border: "1px solid #ccc", borderRadius: "6px" }} /></label>
        <label style={{ display: "grid", gap: "0.35rem" }}>Time limit (minutes)<input type="number" min={1} value={String(effectiveTime)} readOnly style={{ ...compactFieldStyle, background: "#f9fafb" }} /><span style={{ color: "#666", fontSize: "0.85rem" }}>Time limit follows the selected CloudShare Policy runtime lease.</span></label>
        <label style={{ display: "grid", gap: "0.35rem" }}>Open period (minutes)<input type="number" min={Number(effectiveTime) || 1} max={selectedPolicy?.storageLeaseMinutes ?? undefined} value={openPeriodMinutes} onChange={(e) => { setOpenPeriodMinutes(e.target.value); setFeedback(null); }} style={compactFieldStyle} /><span style={{ color: "#666", fontSize: "0.85rem" }}>CloudShare Experience duration from scheduled start; defaults to the Policy runtime lease.</span></label>
        <label style={{ display: "flex", gap: "0.5rem", alignItems: "center", gridColumn: "1 / -1" }}><input type="checkbox" checked={scoreRetrievalEnabled} onChange={(e) => setScoreRetrievalEnabled(e.target.checked)} /> Retrieve Guided Journey score for this Exam</label>
        <label style={{ display: "grid", gap: "0.35rem" }}>Delivery availability<select value={deliveryAvailability} onChange={(e) => setDeliveryAvailability(e.target.value as "individual" | "cohort" | "both")} style={compactFieldStyle}>{getDeliveryAvailabilityAuthoringOptions(deliveryAvailability).map((option) => <option key={option.value} value={option.value} disabled={option.disabled}>{option.label}</option>)}</select></label>
      </div>
      <ExamAuthoringSelectionSummary selectedProject={selectedProject} selectedBlueprint={selectedBlueprint} defaultSnapshot={defaultSnapshot} selectedAllowedRegions={selectedAllowedRegions} selectedPolicy={selectedPolicy} deliveryAvailability={deliveryAvailability} duplicateExamResourceTupleWarning={duplicateWarning} />
      <div style={{ display: "flex", gap: "0.75rem", alignItems: "center", flexWrap: "wrap" }}><button onClick={() => void saveDraft()} disabled={loading || allowedRegionValidationMessage !== null} style={primaryButtonStyle}>{loading ? "Saving..." : editingExamId ? "Update Draft Exam" : "Save Draft Exam"}</button>{editingExamId ? <button onClick={navigateCatalog} disabled={loading} style={secondaryButtonStyle}>Cancel Edit</button> : null}{message ? <span style={{ color: "#0a7a28" }}>{message}</span> : null}</div>
      {feedback ? <p role="alert" style={{ color: "#b42318" }}>{feedback}</p> : null}
    </> : null}
    {props.examView === "catalog" ? <CatalogTables activeExams={activeExams} archivedExams={archivedExams} loading={loading} editingExamId={editingExamId} hasActiveCohortSessions={props.getHasActiveCohortSessions} onEdit={(exam) => void editExam(exam)} onLifecycle={(id, action) => void lifecycle(id, action)} onSessions={(examId) => props.onNavigate({ tab: "exams", examView: "sessions", examId })} /> : null}
  </section>;
}

function CatalogTables(props: {
  readonly activeExams: readonly ExamRecord[]; readonly archivedExams: readonly ExamRecord[]; readonly loading: boolean; readonly editingExamId: string | null;
  readonly hasActiveCohortSessions: (examId: string) => boolean; readonly onEdit: (exam: ExamRecord) => void;
  readonly onLifecycle: (id: string, action: "publish" | "unpublish" | "archive") => void; readonly onSessions: (examId: string) => void;
}) {
  const table = (exams: readonly ExamRecord[], empty: string) => (
    <div style={{ ...cardStyle, padding: 0, overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem" }}>
        <thead>
          <tr style={{ background: colors.surfaceSubtle }}>
            {["Title", "Status", "Project", "Blueprint / Snapshot", "Allowed Regions", "Policy", "Duration", "Score", "Action"].map((heading) => (
              <th key={heading} style={{ textAlign: "left", padding: "0.4rem", borderBottom: `1px solid ${colors.border}` }}>{heading}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {exams.length === 0 ? <tr><td colSpan={9} style={{ padding: "0.5rem", color: colors.textSecondary }}>{empty}</td></tr> : exams.map((exam) => (
            <tr key={exam.id} style={{ borderBottom: `1px solid ${colors.border}`, verticalAlign: "top" }}>
              <td style={{ padding: "0.4rem" }}><div style={{ fontWeight: 600 }}>{exam.title}</div><div style={{ color: colors.textSecondary }}>{exam.description}</div><div style={{ color: colors.textSecondary, fontSize: "0.75rem" }}>Exam ID: {formatShortExamId(exam.id)}{exam.createdAt ? ` · Created ${formatAdminUtcTimestamp(exam.createdAt)}` : ""} · Delivery: {formatExamDeliveryAvailability(exam.deliveryAvailability)}</div></td>
              <td style={{ padding: "0.4rem" }}>
                <span style={statusBadgeStyle(getExamStatusTone(exam.status))}>{exam.status}</span>
                {exam.publishedAt ? <div style={{ color: colors.textSecondary, fontSize: "0.75rem" }}>{formatAdminUtcTimestamp(exam.publishedAt)}</div> : null}
                {exam.archivedAt ? <div style={{ color: colors.textSecondary, fontSize: "0.75rem" }}>Archived {formatAdminUtcTimestamp(exam.archivedAt)}</div> : null}
              </td>
              <td style={{ padding: "0.4rem" }}>{exam.projectName}</td>
              <td style={{ padding: "0.4rem" }}><div>{exam.blueprintName}</div><div style={{ color: colors.textSecondary }}>{exam.snapshotName}</div></td>
              <td style={{ padding: "0.4rem" }}>{exam.allowedRegions.map((region) => region.name).join(", ")}</td>
              <td style={{ padding: "0.4rem" }}>{exam.policyName}</td>
              <td style={{ padding: "0.4rem" }}><div>{exam.timeLimitMinutes} min runtime</div><div>{exam.openPeriodMinutes} min open</div>{exam.storageLeaseMinutes ? <div>{exam.storageLeaseMinutes} min storage</div> : null}</td>
              <td style={{ padding: "0.4rem" }}>{exam.scoreRetrievalEnabled ? "Enabled" : "Off"}</td>
              <td style={{ padding: "0.4rem" }}><ExamCatalogRowActions exam={exam} loading={props.loading} editingExamId={props.editingExamId} hasActiveCohortSessions={props.hasActiveCohortSessions(exam.id)} onEdit={() => props.onEdit(exam)} onPublish={() => props.onLifecycle(exam.id, "publish")} onUnpublish={() => props.onLifecycle(exam.id, "unpublish")} onArchive={() => props.onLifecycle(exam.id, "archive")} onManageCohortSessions={() => props.onSessions(exam.id)} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
  return <div><h2 style={{ marginBottom: "0.6rem" }}>Current Exam Catalog</h2><p style={{ marginTop: 0, color: colors.textSecondary }}>Open an Exam to manage its draft Cohort Exam Sessions. The catalog overview stays list-only.</p>{table(props.activeExams, "No exams yet.")}<h2 style={{ margin: "1.5rem 0 0.6rem" }}>Archived Exams</h2><p style={{ marginTop: 0, color: colors.textSecondary }}>Archived Individual Exams stay available for history, diagnostics, and support review.</p>{table(props.archivedExams, "No archived exams.")}</div>;
}
