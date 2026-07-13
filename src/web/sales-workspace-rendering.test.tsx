import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("SalesWorkspace record rendering", () => {
  it("uses durable record IDs rather than list positions as React keys", () => {
    const source = readFileSync("src/web/sales-workspace.tsx", "utf8");

    expect(source).toContain("key={record.id}");
    expect(source).not.toContain("key={index}");
  });
});
