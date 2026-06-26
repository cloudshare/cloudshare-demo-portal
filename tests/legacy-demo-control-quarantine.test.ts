import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const demoRouteFiles = [
  "app/api/demo/state/route.ts",
  "app/api/demo/step/route.ts",
  "app/api/demo/reset/route.ts",
] as const;

describe("legacy simulator demo-control quarantine", () => {
  it("keeps /api/demo route adapters pointed at the legacy simulator compatibility module", () => {
    for (const routeFile of demoRouteFiles) {
      const source = readFileSync(routeFile, "utf8");
      expect(source).toContain("@/api/legacy-simulator-demo-control");
      expect(source).not.toContain("@/api/demo-control");
    }
  });

  it("documents /demo as legacy simulator compatibility instead of an active API module", () => {
    const readme = readFileSync("README.md", "utf8");

    expect(readme).toContain("## Legacy Demo Control Panel");
    expect(readme).toContain("src/api/legacy-simulator-demo-control.ts");
    expect(readme).not.toContain("src/api/demo-control.ts");
  });
});
