import type { CSSProperties } from "react";
import { colors } from "./design-tokens";
import {
  portalHeaderAccountActionsStyle,
  portalHeaderAccountPanelStyle,
  portalHeaderIntroStyle,
  portalHeaderLayoutStyle,
} from "./portal-page-header";

export const candidateHomeHeaderStyle: CSSProperties = portalHeaderLayoutStyle;

export const candidateHomeHeaderIntroStyle: CSSProperties = portalHeaderIntroStyle;

export const candidateHomeAccountActionsStyle: CSSProperties = portalHeaderAccountActionsStyle;

export const candidateHomeAccountPanelStyle: CSSProperties = portalHeaderAccountPanelStyle;

export const publishedExamHeaderStyle: CSSProperties = {
  display: "grid",
  gap: "0.5rem",
};

export const publishedExamTitleRowStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  gap: "1rem",
  alignItems: "flex-start",
  flexWrap: "wrap",
};

export const publishedExamTitleBlockStyle: CSSProperties = {
  minWidth: 0,
  flex: "1 1 18rem",
};

export const publishedExamDescriptionStyle: CSSProperties = {
  margin: "0.5rem 0 0",
  color: colors.textSecondary,
  lineHeight: 1.5,
  maxWidth: "68rem",
};

export const publishedExamDurationPillsStyle: CSSProperties = {
  display: "flex",
  gap: "0.5rem",
  flexWrap: "wrap",
  justifyContent: "flex-end",
  flex: "1 1 auto",
  minWidth: 0,
  maxWidth: "100%",
};

export const publishedExamActionRowStyle: CSSProperties = {
  display: "flex",
  gap: "0.9rem",
  alignItems: "end",
  justifyContent: "space-between",
  flexWrap: "wrap",
};

export const publishedExamScheduleFieldStyle: CSSProperties = {
  display: "grid",
  gap: "0.35rem",
  flex: "1 1 22rem",
  maxWidth: "44rem",
};

export const publishedExamActionGroupStyle: CSSProperties = {
  display: "flex",
  gap: "0.75rem",
  flexWrap: "wrap",
  alignItems: "center",
  justifyContent: "flex-end",
  marginLeft: "auto",
};

export const publishedExamDisclosureSummaryStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  gap: "1rem",
  flexWrap: "wrap",
  alignItems: "center",
  cursor: "pointer",
  listStyle: "none",
};

export const publishedExamDisclosureBodyStyle: CSSProperties = {
  display: "grid",
  gap: "0.9rem",
  marginTop: "1rem",
  paddingTop: "1rem",
  borderTop: "1px solid #e2e8f0",
};
