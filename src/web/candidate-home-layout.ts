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
