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
});
