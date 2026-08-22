"use client";

import React, { useCallback, useState } from "react";
import { AdminCohortExamSessionsFeature } from "./admin-cohort-exam-sessions";
import { AdminExamCatalogAuthoringFeature, type ExamRecord } from "./admin-exam-catalog-authoring";
import { AdminSessionMonitoringFeature } from "./admin-session-monitoring";
import type { AdminAuthenticatedRequest } from "./admin-authenticated-request";
import type { AdminDeliveryView, AdminExamView, AdminNavigationIntent } from "./admin-shell-route";
import { cardStyle, mutedPanelStyle } from "./card-styles";
import { primaryButtonStyle, secondaryButtonStyle } from "./button-styles";
import { colors } from "./design-tokens";

export interface AdminExamWorkspaceFeatureProps {
  readonly active: boolean;
  readonly examFeatureActive: boolean;
  readonly examView: AdminExamView;
  readonly focusedExamId: string | null;
  readonly focusedCohortSessionId: string | null;
  readonly supportMonitoringActive: boolean;
  readonly deliveryView: AdminDeliveryView | null;
  readonly fetchAdmin: AdminAuthenticatedRequest;
  readonly onNavigate: (intent: AdminNavigationIntent) => void;
  readonly getNavigationHref: (intent: AdminNavigationIntent) => string;
}

/** Composes sibling Exam Catalog and Cohort Exam Session features without expanding the shell. */
export function AdminExamWorkspaceFeature(props: AdminExamWorkspaceFeatureProps) {
  const [hasActiveCohortSessionsByExamId, setHasActiveCohortSessionsByExamId] = useState<Record<string, boolean>>({});
  const [catalog, setCatalog] = useState<{ activeExams: readonly ExamRecord[]; archivedExams: readonly ExamRecord[] } | null>(null);
  const monitoringBranch = props.supportMonitoringActive ? props.deliveryView : null;
  const catalogActive = props.examFeatureActive && (props.examView === "catalog" || props.examView === "create" || props.examView === "edit");
  const updateCohortActivity = useCallback((activity: Record<string, boolean>) => {
    setHasActiveCohortSessionsByExamId((current) => JSON.stringify(current) === JSON.stringify(activity) ? current : activity);
  }, []);
  const hasFocusedCohort = Boolean(props.focusedExamId && props.focusedCohortSessionId);
  const cohortMonitoringActive = props.supportMonitoringActive && (hasFocusedCohort || monitoringBranch === "cohort");
  const individualMonitoringVisible = props.supportMonitoringActive && !hasFocusedCohort && monitoringBranch === "individual";

  return <>
    {props.examFeatureActive && props.deliveryView ? <div style={{ ...mutedPanelStyle, marginBottom: "1rem" }}><strong>{props.deliveryView === "individual" ? "Individual delivery" : "Cohort delivery"}</strong><p style={{ marginBottom: 0 }}>{props.deliveryView === "individual" ? "Manage Exams available for one-Candidate CloudShare Experiences. Candidate scheduling and ExamAttempt timing remain unchanged." : "Open a Cohort-capable Exam to manage its inherited Cohort Exam Sessions. CloudShare resources continue to come from the parent Exam."}</p></div> : null}
    <AdminExamCatalogAuthoringFeature
      active={catalogActive}
      examView={props.examView}
      focusedExamId={props.focusedExamId}
      deliveryView={props.examFeatureActive ? props.deliveryView : null}
      fetchAdmin={props.fetchAdmin}
      onNavigate={props.onNavigate}
      onCatalogChange={setCatalog}
      getHasActiveCohortSessions={(examId) => hasActiveCohortSessionsByExamId[examId] ?? false}
    />
    {props.supportMonitoringActive && !hasFocusedCohort ? <>
      <div style={{ ...cardStyle, display: "flex", gap: "0.75rem", flexWrap: "wrap" }} aria-label="Session Monitoring branches">
        <button type="button" onClick={() => props.onNavigate({ tab: "support", supportView: "monitoring", deliveryView: "cohort" })} style={monitoringBranch === "cohort" ? primaryButtonStyle : secondaryButtonStyle}>Cohort Exam Sessions</button>
        <button type="button" onClick={() => props.onNavigate({ tab: "support", supportView: "monitoring", deliveryView: "individual" })} style={monitoringBranch === "individual" ? primaryButtonStyle : secondaryButtonStyle}>Individual Exam Delivery</button>
      </div>
      {monitoringBranch === null ? <div style={{ ...mutedPanelStyle, color: colors.textSecondary }}>Choose a monitoring view. Cohort Exam Sessions monitor a shared CloudShare Experience; Individual Exam Delivery monitors one Candidate attempt at a time.</div> : null}
    </> : null}
    <AdminCohortExamSessionsFeature
      active={props.active && (!props.supportMonitoringActive || cohortMonitoringActive)}
      examView={props.examView}
      focusedExamId={props.focusedExamId}
      focusedCohortSessionId={props.focusedCohortSessionId}
      supportMonitoringActive={cohortMonitoringActive}
      fetchAdmin={props.fetchAdmin}
      onNavigate={props.onNavigate}
      getNavigationHref={props.getNavigationHref}
      onCohortActivityChange={updateCohortActivity}
      catalog={catalog}
    />
    <AdminSessionMonitoringFeature active={props.supportMonitoringActive} visible={individualMonitoringVisible} fetchAdmin={props.fetchAdmin} onNavigate={props.onNavigate} />
  </>;
}
