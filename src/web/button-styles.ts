import type { CSSProperties } from "react";
import { colors, radius } from "./design-tokens";

const baseButtonStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: "0.4rem",
  padding: "0.65rem 1.1rem",
  borderRadius: radius.sm,
  fontWeight: 600,
  fontSize: "0.95rem",
  lineHeight: 1.2,
};

export const primaryButtonStyle: CSSProperties = {
  ...baseButtonStyle,
  border: `1px solid ${colors.accent}`,
  background: colors.accent,
  color: "#ffffff",
};

export const secondaryButtonStyle: CSSProperties = {
  ...baseButtonStyle,
  border: `1px solid ${colors.accentBorder}`,
  background: colors.accentSoft,
  color: colors.accentStrong,
};

export const accountLogoutButtonStyle: CSSProperties = {
  ...baseButtonStyle,
  border: `1px solid ${colors.borderStrong}`,
  background: colors.surfaceSubtle,
  color: colors.textPrimary,
};

export const dangerButtonStyle: CSSProperties = {
  ...baseButtonStyle,
  border: `1px solid ${colors.danger}`,
  background: colors.danger,
  color: "#ffffff",
};

export const compactButtonStyle: CSSProperties = {
  ...secondaryButtonStyle,
  padding: "0.4rem 0.75rem",
  fontSize: "0.85rem",
};

export const disabledButtonStyle: CSSProperties = {
  background: colors.surfaceSubtle,
  border: `1px solid ${colors.border}`,
  color: colors.textMuted,
  cursor: "not-allowed",
};
