"use client";

import React, { useCallback, useState } from "react";
import { AdminCohortExamSessionsFeature } from "./admin-cohort-exam-sessions";
import { AdminExamCatalogAuthoringFeature, type ExamRecord } from "./admin-exam-catalog-authoring";
import type { AdminAuthenticatedRequest } from "./admin-authenticated-request";
import type { AdminExamView, AdminNavigationIntent } from "./admin-shell-route";

export interface AdminExamWorkspaceFeatureProps {
  readonly active: boolean;
  readonly examFeatureActive: boolean;
  readonly examView: AdminExamView;
  readonly focusedExamId: string | null;
  readonly focusedCohortSessionId: string | null;
  readonly supportMonitoringActive: boolean;
  readonly fetchAdmin: AdminAuthenticatedRequest;
  readonly onNavigate: (intent: AdminNavigationIntent) => void;
  readonly getNavigationHref: (intent: AdminNavigationIntent) => string;
}

/** Composes sibling Exam Catalog and Cohort Exam Session features without expanding the shell. */
export function AdminExamWorkspaceFeature(props: AdminExamWorkspaceFeatureProps) {
  const [hasActiveCohortSessionsByExamId, setHasActiveCohortSessionsByExamId] = useState<Record<string, boolean>>({});
  const [catalog, setCatalog] = useState<{ activeExams: readonly ExamRecord[]; archivedExams: readonly ExamRecord[] } | null>(null);
  const catalogActive = props.examFeatureActive && (props.examView === "catalog" || props.examView === "create" || props.examView === "edit");
  const updateCohortActivity = useCallback((activity: Record<string, boolean>) => {
    setHasActiveCohortSessionsByExamId((current) => JSON.stringify(current) === JSON.stringify(activity) ? current : activity);
  }, []);

  return <>
    <AdminExamCatalogAuthoringFeature
      active={catalogActive}
      examView={props.examView}
      focusedExamId={props.focusedExamId}
      fetchAdmin={props.fetchAdmin}
      onNavigate={props.onNavigate}
      onCatalogChange={setCatalog}
      getHasActiveCohortSessions={(examId) => hasActiveCohortSessionsByExamId[examId] ?? false}
    />
    <AdminCohortExamSessionsFeature
      active={props.active}
      examView={props.examView}
      focusedExamId={props.focusedExamId}
      focusedCohortSessionId={props.focusedCohortSessionId}
      supportMonitoringActive={props.supportMonitoringActive}
      fetchAdmin={props.fetchAdmin}
      onNavigate={props.onNavigate}
      getNavigationHref={props.getNavigationHref}
      onCohortActivityChange={updateCohortActivity}
      catalog={catalog}
    />
  </>;
}
