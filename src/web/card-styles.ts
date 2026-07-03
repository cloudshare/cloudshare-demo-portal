import type { CSSProperties } from "react";
import { colors, radius, shadow, spacing } from "./design-tokens";

export const cardStyle: CSSProperties = {
  border: `1px solid ${colors.border}`,
  borderRadius: radius.md,
  background: colors.surface,
  padding: spacing.lg,
  boxShadow: shadow.sm,
};

export const mutedPanelStyle: CSSProperties = {
  border: `1px solid ${colors.border}`,
  borderRadius: radius.md,
  background: colors.surfaceMuted,
  padding: spacing.lg,
};

export const alertPanelStyle: Record<"danger" | "warning" | "info" | "success", CSSProperties> = {
  danger: {
    border: `1px solid ${colors.danger}`,
    borderRadius: radius.md,
    background: colors.dangerSoft,
    color: colors.danger,
    padding: spacing.md,
  },
  warning: {
    border: `1px solid ${colors.warning}`,
    borderRadius: radius.md,
    background: colors.warningSoft,
    color: colors.warning,
    padding: spacing.md,
  },
  info: {
    border: `1px solid ${colors.info}`,
    borderRadius: radius.md,
    background: colors.infoSoft,
    color: colors.info,
    padding: spacing.md,
  },
  success: {
    border: `1px solid ${colors.success}`,
    borderRadius: radius.md,
    background: colors.successSoft,
    color: colors.success,
    padding: spacing.md,
  },
};
