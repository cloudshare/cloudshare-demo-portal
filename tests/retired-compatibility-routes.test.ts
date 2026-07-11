import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";

const retiredRouteFiles = [
  "app/api/candidate/admit/route.ts",
  "app/api/candidate/session/route.ts",
  "app/api/exams/book/route.ts",
  "app/api/exams/eligible/route.ts",
  "app/api/lab/launch/route.ts",
] as const;

describe("retired compatibility routes", () => {
  it("does not ship retired candidate or simulator endpoints", () => {
    for (const routeFile of retiredRouteFiles) {
      expect(existsSync(routeFile)).toBe(false);
    }
  });
});
