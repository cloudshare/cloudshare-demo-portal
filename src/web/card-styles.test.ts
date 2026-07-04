import { describe, expect, it } from "vitest";
import { alertPanelStyle, cardStyle, mutedPanelStyle } from "./card-styles";

describe("card styles", () => {
  it("gives the standard card a soft shadow, unlike the flat muted panel", () => {
    expect(cardStyle.boxShadow).toBeTruthy();
    expect(mutedPanelStyle.boxShadow).toBeUndefined();
    expect(cardStyle.borderRadius).toBe(mutedPanelStyle.borderRadius);
  });

  it("gives every alert tone a distinct background with a matching text color", () => {
    const tones = Object.values(alertPanelStyle);
    const backgrounds = tones.map((tone) => tone.background);
    expect(new Set(backgrounds).size).toBe(tones.length);
    tones.forEach((tone) => expect(tone.color).toBeTruthy());
  });
});
