"use client";

import React from "react";
import type { AdminExamView } from "./admin-shell-route";
import { secondaryButtonStyle } from "./button-styles";
import { colors } from "./design-tokens";

const navigationStyle: React.CSSProperties = {
  display: "flex", flexWrap: "wrap", gap: "0.45rem", margin: 0, padding: 0,
  listStyle: "none", alignItems: "center",
};

const buttonStyle: React.CSSProperties = {
  ...secondaryButtonStyle, padding: "0.4rem 0.7rem", fontSize: "0.85rem",
  background: colors.surfaceSubtle, borderColor: colors.border,
};

const currentStyle: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", padding: "0.4rem 0.7rem",
  borderRadius: "999px", border: `1px solid ${colors.border}`, background: colors.surface,
  color: colors.textPrimary, fontSize: "0.85rem", fontWeight: 600,
};

export function ExamWorkspaceBreadcrumbs(props: {
  readonly examView: AdminExamView;
  readonly focusedExamTitle: string | null;
  readonly focusedSessionName?: string | null;
  readonly onNavigateToCatalog: () => void;
  readonly onNavigateToSessions?: () => void;
}) {
  const items: Array<{ key: string; label: string; current: boolean; onClick?: () => void }> = [
    { key: "catalog", label: "Catalog overview", current: props.examView === "catalog", onClick: props.examView === "catalog" ? undefined : props.onNavigateToCatalog },
  ];
  if (props.examView === "edit" || props.examView === "create") items.push({ key: props.examView, label: props.examView === "edit" ? "Edit Exam" : "Create Exam", current: true });
  if ((props.examView === "sessions" || props.examView === "session") && props.focusedExamTitle) items.push({ key: "sessions", label: `Cohort Sessions: ${props.focusedExamTitle}`, current: props.examView === "sessions", onClick: props.examView === "session" ? props.onNavigateToSessions : undefined });
  if (props.examView === "session" && props.focusedSessionName) items.push({ key: "session", label: props.focusedSessionName, current: true });

  return <nav aria-label="Exam workspace"><ol style={navigationStyle}>{items.map((item, index) => <React.Fragment key={item.key}>{index > 0 ? <li aria-hidden="true" style={{ color: colors.textMuted }}>/</li> : null}<li>{item.current ? <span aria-current="page" style={currentStyle}>{item.label}</span> : <button type="button" onClick={item.onClick} style={buttonStyle}>{item.label}</button>}</li></React.Fragment>)}</ol></nav>;
}
