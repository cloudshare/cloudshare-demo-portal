import { describe, expect, it } from "vitest";
import { colors, radius, spacing } from "./design-tokens";

function remToNumber(value: string): number {
  return Number(value.replace("rem", ""));
}

describe("design tokens", () => {
  it("gives every semantic color role a distinct value", () => {
    const roles = [colors.accent, colors.danger, colors.warning, colors.success, colors.info, colors.neutral];
    expect(new Set(roles).size).toBe(roles.length);
  });

  it("keeps the spacing scale strictly increasing", () => {
    const scale = [spacing.xs, spacing.sm, spacing.md, spacing.lg, spacing.xl, spacing.xxl].map(remToNumber);
    for (let i = 1; i < scale.length; i += 1) {
      expect(scale[i]).toBeGreaterThan(scale[i - 1]);
    }
  });

  it("uses a fully-rounded pill radius for badges", () => {
    expect(radius.pill).toBe("999px");
  });
});
