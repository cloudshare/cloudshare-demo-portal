import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("global styles", () => {
  it("reserves scrollbar width so centered admin tabs do not shift as tab height changes", () => {
    const css = readFileSync(join(process.cwd(), "app", "globals.css"), "utf8");

    expect(css).toContain("scrollbar-gutter: stable");
  });
});
