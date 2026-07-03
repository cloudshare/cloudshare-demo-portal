import type { CSSProperties } from "react";

export const colors = {
  surface: "#ffffff",
  surfaceMuted: "#f8fafc",
  surfaceSubtle: "#f1f5f9",
  border: "#e2e8f0",
  borderStrong: "#cbd5e1",
  textPrimary: "#0f172a",
  textSecondary: "#475569",
  textMuted: "#64748b",
  accent: "#0f6d66",
  accentStrong: "#0b544f",
  accentSoft: "#effaf7",
  danger: "#b91c1c",
  dangerSoft: "#fef2f2",
  warning: "#b45309",
  warningSoft: "#fffbeb",
  success: "#047857",
  successSoft: "#ecfdf5",
  info: "#1d4ed8",
  infoSoft: "#eff6ff",
  neutral: "#475569",
  neutralSoft: "#f1f5f9",
} as const;

export const spacing = {
  xs: "0.35rem",
  sm: "0.6rem",
  md: "1rem",
  lg: "1.5rem",
  xl: "2rem",
  xxl: "3rem",
} as const;

export const radius = {
  sm: "6px",
  md: "10px",
  lg: "14px",
  pill: "999px",
} as const;

export const shadow = {
  sm: "0 1px 2px rgba(15, 23, 42, 0.06)",
  md: "0 4px 16px rgba(15, 23, 42, 0.08)",
} as const;

export const fontFamily = {
  display: "var(--font-display, Georgia, serif)",
  body: "var(--font-body, system-ui, sans-serif)",
} as const;

export const pageHeadingStyle: CSSProperties = {
  fontFamily: fontFamily.display,
  fontWeight: 600,
  letterSpacing: "-0.01em",
  color: colors.textPrimary,
};

export const eyebrowLabelStyle: CSSProperties = {
  margin: 0,
  color: colors.accent,
  fontSize: "0.78rem",
  fontWeight: 700,
  letterSpacing: "0.06em",
  textTransform: "uppercase",
};
