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
});
