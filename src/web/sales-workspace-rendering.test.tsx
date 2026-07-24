import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("SalesWorkspace record rendering", () => {
  it("uses durable record IDs rather than list positions as React keys", () => {
    const source = readFileSync("src/web/sales-workspace.tsx", "utf8");

    expect(source).toContain("key={record.id}");
    expect(source).not.toContain("key={index}");
  });

  it("aligns the template save action with its input instead of the label", () => {
    const source = readFileSync("src/web/sales-workspace.tsx", "utf8");

    expect(source).toContain(".sales-session-template-action { align-self: start; margin-top: calc(1.2em + 0.35rem); }");
    expect(source).toContain('className="sales-session-template-action"');
  });

  it("keeps readable navigation labels at constrained desktop widths", () => {
    const styles = readFileSync("src/web/sales-workspace.module.css", "utf8");

    expect(styles).not.toMatch(/@media \(max-width: 65rem\)[\s\S]*?\.navButton \{[^}]*font-size:\s*0;/);
  });
});
