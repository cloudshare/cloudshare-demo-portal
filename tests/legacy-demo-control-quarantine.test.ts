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
    expect(readme).toContain("legacySimulatorDemo");
    expect(readme).toContain("It does not expose the");
    expect(readme).not.toContain("src/api/demo-control.ts");
  });

  it("keeps retired simulator services out of the active top-level composition interface", () => {
    const composition = readFileSync("src/composition.ts", "utf8");
    const legacyDemoServicesInterface = composition.match(
      /export interface LegacySimulatorDemoServices \{(?<body>[\s\S]*?)\n\}/,
    )?.groups?.body;
    const servicesInterface = composition.match(
      /export interface Services \{(?<body>[\s\S]*?)\n\}/,
    )?.groups?.body;

    expect(legacyDemoServicesInterface).toBeDefined();
    expect(legacyDemoServicesInterface).toContain("completedDemoSteps");
    expect(legacyDemoServicesInterface).toContain("markStepDone");
    expect(legacyDemoServicesInterface).toContain("resetDemo");

    expect(servicesInterface).toBeDefined();
    expect(servicesInterface).toContain("legacySimulatorDemo");
    expect(servicesInterface).not.toMatch(/\n\s+kryterion:/);
    expect(servicesInterface).not.toMatch(/\n\s+genesys:/);
    expect(servicesInterface).not.toMatch(/\n\s+completedDemoSteps:/);
    expect(servicesInterface).not.toMatch(/\n\s+markStepDone\(/);
    expect(servicesInterface).not.toMatch(/\n\s+resetDemo\(/);
  });

  it("treats the legacy demo bundle as required service shape for hot reload reuse", () => {
    const composition = readFileSync("src/composition.ts", "utf8");
    const reuseGuard = composition.match(
      /function isReusableServices\(services: Services\): boolean \{(?<body>[\s\S]*?)\n\}/,
    )?.groups?.body;

    expect(reuseGuard).toBeDefined();
    expect(reuseGuard).toContain("legacySimulatorDemo");
    expect(reuseGuard).toContain("completedDemoSteps");
    expect(reuseGuard).toContain("markStepDone");
    expect(reuseGuard).toContain("resetDemo");
  });

  it("builds /demo dependencies from the legacy simulator compatibility bundle", () => {
    const demoControl = readFileSync("src/api/legacy-simulator-demo-control.ts", "utf8");
    const buildDemoDeps = demoControl.match(
      /export function buildDemoDeps\(svc: Services\): DemoControlDeps \{(?<body>[\s\S]*?)\n\}/,
    )?.groups?.body;

    expect(buildDemoDeps).toBeDefined();
    expect(buildDemoDeps).toContain(
      "completedDemoSteps: svc.legacySimulatorDemo.completedDemoSteps",
    );
    expect(buildDemoDeps).toContain("markStepDone: svc.legacySimulatorDemo.markStepDone");
    expect(buildDemoDeps).toContain("resetDemoState: svc.legacySimulatorDemo.resetDemo");
  });
});
