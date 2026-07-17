import type { CSSProperties } from "react";
import { colors } from "./design-tokens";

export const workspaceTabNavStyle: CSSProperties = {
  display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(10.5rem, 1fr))", gap: "0.5rem",
  marginBottom: "1rem", borderBottom: `1px solid ${colors.border}`, paddingBottom: "0.5rem", alignItems: "stretch",
};

const workspaceTabButtonBase: CSSProperties = {
  padding: "0.6rem 0.9rem", border: "1px solid", borderRadius: "8px", width: "100%", minHeight: "2.75rem", textAlign: "center", cursor: "pointer",
};

export function workspaceTabButtonStyle(active: boolean, highlighted = false): CSSProperties {
  return { ...workspaceTabButtonBase, background: active ? colors.textPrimary : highlighted ? colors.accentSoft : "#ffffff", color: active ? "#ffffff" : colors.textPrimary, borderColor: active ? colors.textPrimary : highlighted ? "#b9ded7" : colors.borderStrong, fontWeight: active ? 700 : 600, boxShadow: active ? "inset 0 -3px 0 #0f6d66" : "none" };
}
