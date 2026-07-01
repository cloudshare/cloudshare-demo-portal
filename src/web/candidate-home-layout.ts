import type { CSSProperties } from "react";

export const candidateHomeHeaderStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "flex-start",
  gap: "1rem",
  flexWrap: "wrap",
};

export const candidateHomeHeaderIntroStyle: CSSProperties = {
  flex: "1 1 28rem",
  minWidth: 0,
  maxWidth: "42rem",
};

export const candidateHomeAccountActionsStyle: CSSProperties = {
  display: "grid",
  gap: "0.75rem",
  justifyItems: "stretch",
  flex: "0 1 18rem",
  minWidth: 0,
  maxWidth: "100%",
};

export const candidateHomeAccountPanelStyle: CSSProperties = {
  border: "1px solid #d9e1e8",
  borderRadius: "8px",
  background: "#ffffff",
  padding: "0.9rem 1rem",
  width: "100%",
  minWidth: 0,
  boxSizing: "border-box",
};

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
  color: "#444",
  lineHeight: 1.5,
  maxWidth: "44rem",
};

export const publishedExamDurationPillsStyle: CSSProperties = {
  display: "flex",
  gap: "0.5rem",
  flexWrap: "wrap",
  justifyContent: "flex-end",
  flex: "0 0 auto",
};
