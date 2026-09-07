import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("global styles", () => {
  it("reserves scrollbar width so centered admin tabs do not shift as tab height changes", () => {
    const css = readFileSync(join(process.cwd(), "app", "globals.css"), "utf8");

    expect(css).toContain("scrollbar-gutter: stable");
  });

  it("keeps every disabled button visually distinct from the shared secondary treatment", () => {
    const css = readFileSync(join(process.cwd(), "app", "globals.css"), "utf8");

    expect(css).toContain("button:disabled");
    expect(css).toContain("background: #dbe3ec !important");
    expect(css).toContain("border-color: #64748b !important");
    expect(css).toContain("color: #475569 !important");
    expect(css).toContain("opacity: 0.55");
  });

  it("disables Candidate attempt card flips through the native reduced-motion media query", () => {
    const css = readFileSync(join(process.cwd(), "app", "globals.css"), "utf8");

    expect(css).toContain(".candidate-attempt-flip-inner");
    expect(css).toContain("transition: transform 260ms ease");
    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*\.candidate-attempt-flip-inner[\s\S]*transition: none/);
  });
});
