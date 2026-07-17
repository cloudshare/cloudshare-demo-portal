import { describe, expect, it } from "vitest";
import {
  accountLogoutButtonStyle,
  compactButtonStyle,
  dangerButtonStyle,
  disabledButtonStyle,
  primaryButtonStyle,
  secondaryButtonStyle,
} from "./button-styles";

describe("button styles", () => {
  it("gives primary and secondary buttons the same shape but different fills", () => {
    expect(primaryButtonStyle.borderRadius).toBe(secondaryButtonStyle.borderRadius);
    expect(primaryButtonStyle.padding).toBe(secondaryButtonStyle.padding);
    expect(primaryButtonStyle.background).not.toBe(secondaryButtonStyle.background);
    expect(primaryButtonStyle.color).toBe("#ffffff");
    expect(secondaryButtonStyle.color).not.toBe("#ffffff");
  });

  it("marks danger actions distinctly from primary", () => {
    expect(dangerButtonStyle.background).not.toBe(primaryButtonStyle.background);
  });

  it("keeps account logout visually separate from navigation and primary actions", () => {
    expect(accountLogoutButtonStyle.borderRadius).toBe(secondaryButtonStyle.borderRadius);
    expect(accountLogoutButtonStyle.padding).toBe(secondaryButtonStyle.padding);
    expect(accountLogoutButtonStyle.background).not.toBe(secondaryButtonStyle.background);
    expect(accountLogoutButtonStyle.background).not.toBe(primaryButtonStyle.background);
    expect(accountLogoutButtonStyle.color).not.toBe(secondaryButtonStyle.color);
  });

  it("keeps the compact button visibly smaller than the standard secondary button", () => {
    expect(String(compactButtonStyle.padding)).not.toBe(String(secondaryButtonStyle.padding));
  });

  it("visually communicates disabled state via color, not just the disabled attribute", () => {
    expect(disabledButtonStyle.cursor).toBe("not-allowed");
    expect(disabledButtonStyle.background).not.toBe(primaryButtonStyle.background);
  });
});
