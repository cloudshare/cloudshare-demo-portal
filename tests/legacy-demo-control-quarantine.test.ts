import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { describe, expect, it } from "vitest";

const retiredDemoRouteFiles = [
  "app/api/demo/state/route.ts",
  "app/api/demo/step/route.ts",
  "app/api/demo/reset/route.ts",
] as const;

const activeCandidateRuntimeFiles = [
  "src/api/candidate-exam-attempt-access.ts",
  "src/api/candidate-portal.ts",
  "src/api/candidate-lab.ts",
  "src/api/candidate-runtime-diagnostics.ts",
  "src/api/enter.ts",
  "src/api/exam-attempt-dashboard-runtime.ts",
  "src/api/exam-attempt-runtime.ts",
  "src/api/exam-attempt-scheduling-runtime.ts",
  "src/api/exam-attempt-score-runtime.ts",
  "src/api/exam-attempt-suspend-resume-runtime.ts",
] as const;

function listSourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = `${directory}/${entry}`;
    const stats = statSync(path);

    if (stats.isDirectory()) {
      return listSourceFiles(path);
    }

    return /\.(?:ts|tsx)$/.test(path) ? [path] : [];
  });
}

describe("legacy simulator demo-control quarantine", () => {
  it("keeps retired Genesys simulator code out of the active integrations tree", () => {
    expect(existsSync("src/integrations/genesys")).toBe(false);
    expect(existsSync("src/legacy-simulator/genesys/simulator.ts")).toBe(true);
    expect(existsSync("src/legacy-simulator/genesys/demo-data.ts")).toBe(true);

    const composition = readFileSync("src/composition.ts", "utf8");
    const demoControl = readFileSync("src/api/legacy-simulator-demo-control.ts", "utf8");

    expect(composition).toContain(
      'import { createGenesysSimulator } from "@/legacy-simulator/genesys/simulator";',
    );
    expect(composition).toContain(
      'import { genesysDemoData } from "@/legacy-simulator/genesys/demo-data";',
    );
    expect(demoControl).toContain(
      'import { DEMO_SEED } from "@/legacy-simulator/genesys/demo-data";',
    );
    expect(`${composition}\n${demoControl}`).not.toContain("@/integrations/genesys");
  });

  it("keeps retired Kryterion simulator code out of the active integrations tree", () => {
    expect(existsSync("src/integrations/kryterion")).toBe(false);
    expect(existsSync("src/legacy-simulator/kryterion/simulator.ts")).toBe(true);

    const composition = readFileSync("src/composition.ts", "utf8");
    const demoControl = readFileSync("src/api/legacy-simulator-demo-control.ts", "utf8");
    const activeSources = [
      composition,
      demoControl,
      ...activeCandidateRuntimeFiles.map((file) => readFileSync(file, "utf8")),
    ].join("\n");

    expect(composition).toContain(
      'from "@/legacy-simulator/kryterion/simulator";',
    );
    expect(demoControl).toContain(
      'from "@/legacy-simulator/kryterion/simulator";',
    );
    expect(activeSources).not.toContain("@/integrations/kryterion");
  });

  it("keeps the retired bookExam use case under an explicit legacy simulator path", () => {
    expect(existsSync("src/domain/booking.ts")).toBe(false);
    expect(existsSync("src/legacy-simulator/book-exam.ts")).toBe(true);
  });

  it("keeps retired eligibility in the legacy simulator quarantine", () => {
    expect(existsSync("src/domain/eligibility.ts")).toBe(false);
    expect(existsSync("src/legacy-simulator/eligibility.ts")).toBe(true);

    const allSources = [...listSourceFiles("src"), ...listSourceFiles("tests")];
    const retiredDomainEligibilityImport = ["@/domain", "eligibility"].join("/");
    const domainEligibilityImports = allSources.filter((file) =>
      readFileSync(file, "utf8").includes(retiredDomainEligibilityImport),
    );
    const activeRuntimeLegacyEligibilityImports = activeCandidateRuntimeFiles.filter((file) =>
      readFileSync(file, "utf8").includes("@/legacy-simulator/eligibility"),
    );

    expect(domainEligibilityImports).toEqual([]);
    expect(activeRuntimeLegacyEligibilityImports).toEqual([]);
  });

  it("renames the active suspend/resume domain boundary to ExamAttempt runtime lifecycle", () => {
    expect(existsSync("src/domain/timer-sync.ts")).toBe(false);
    expect(existsSync("src/domain/exam-attempt-runtime-lifecycle.ts")).toBe(true);

    const suspendResumeRuntime = readFileSync(
      "src/api/exam-attempt-suspend-resume-runtime.ts",
      "utf8",
    );
    const allSources = [...listSourceFiles("src"), ...listSourceFiles("tests")];
    const retiredAliasedTimerSyncImport = ["@/domain", "timer-sync"].join("/");
    const retiredRelativeTimerSyncImport = ["./", "timer-sync"].join("");
    const retiredTimerSyncImports = allSources.filter((file) => {
      const source = readFileSync(file, "utf8");
      return (
        source.includes(retiredAliasedTimerSyncImport) ||
        source.includes(retiredRelativeTimerSyncImport)
      );
    });

    expect(suspendResumeRuntime).toContain(
      'from "@/domain/exam-attempt-runtime-lifecycle";',
    );
    expect(retiredTimerSyncImports).toEqual([]);
  });

  it("keeps retired timer-sync error vocabulary out of active runtime modules", () => {
    const activeRuntimeBoundaryFiles = [
      "src/domain/errors.ts",
      "src/domain/exam-attempt-runtime-lifecycle.ts",
      "src/api/exam-attempt-suspend-resume-runtime.ts",
    ] as const;

    const filesWithRetiredTimerSyncError = activeRuntimeBoundaryFiles.filter((file) =>
      readFileSync(file, "utf8").includes("TimerSyncError"),
    );

    expect(filesWithRetiredTimerSyncError).toEqual([]);
  });

  it("keeps retired provider and booking vocabulary out of active comments and fixtures", () => {
    const activeCommentAndFixtureFiles = [
      "src/domain/integration-event.ts",
      "src/domain/event-bus.ts",
      "src/domain/resource-sync.test.ts",
      "src/web/score-display.tsx",
    ] as const;
    const retiredVocabulary = /\b(?:Genesys|Kryterion|proctor|booking|booked)\b/i;

    const offenders = activeCommentAndFixtureFiles.filter((file) =>
      retiredVocabulary.test(readFileSync(file, "utf8")),
    );
    const composition = readFileSync("src/composition.ts", "utf8");

    expect(offenders).toEqual([]);
    expect(composition).not.toContain("Eligibility & booking");
  });

  it("keeps active Candidate scheduling and runtime handlers from importing retired bookExam", () => {
    const offenders = activeCandidateRuntimeFiles.filter((file) => {
      const source = readFileSync(file, "utf8");
      return (
        source.includes("@/domain/booking") ||
        source.includes("./booking") ||
        source.includes("@/legacy-simulator/book-exam")
      );
    });

    expect(offenders).toEqual([]);
  });

  it("keeps retired booked entitlement and legacy LabLaunch out of the active domain", () => {
    expect(existsSync("src/domain/entitlement.ts")).toBe(false);
    expect(existsSync("src/legacy-simulator/lab-launch.ts")).toBe(true);

    const activeDomainLabLaunch = readFileSync("src/domain/lab-launch.ts", "utf8");
    const demoControl = readFileSync("src/api/legacy-simulator-demo-control.ts", "utf8");
    const activeRuntimeOffenders = activeCandidateRuntimeFiles.filter((file) => {
      const source = readFileSync(file, "utf8");
      return (
        source.includes("@/domain/entitlement") ||
        source.includes("@/legacy-simulator/lab-launch") ||
        source.includes("launchLegacySimulatorLab")
      );
    });

    expect(activeDomainLabLaunch).not.toContain("computeEntitlement");
    expect(activeDomainLabLaunch).not.toContain("launchLab(");
    expect(demoControl).toContain(
      'import { launchLegacySimulatorLab } from "@/legacy-simulator/lab-launch";',
    );
    expect(activeRuntimeOffenders).toEqual([]);
  });

  it("keeps retired token Candidate admission out of active auth and composition", () => {
    expect(existsSync("src/auth/authenticator.ts")).toBe(false);
    expect(existsSync("src/auth/exam-token.ts")).toBe(false);
    expect(existsSync("src/auth/stores.ts")).toBe(false);
    expect(existsSync("src/legacy-simulator/kryterion/exam-token.ts")).toBe(true);

    const authIndex = readFileSync("src/auth/index.ts", "utf8");
    const composition = readFileSync("src/composition.ts", "utf8");
    const kryterionSimulator = readFileSync("src/legacy-simulator/kryterion/simulator.ts", "utf8");

    expect(authIndex).not.toContain("CandidateAuthenticator");
    expect(authIndex).not.toContain("createTokenCandidateAuthenticator");
    expect(authIndex).not.toContain("verifyExamToken");
    expect(authIndex).not.toContain("./exam-token");
    expect(composition).not.toContain("candidateAuth");
    expect(composition).not.toContain("createInMemoryConsumedTokenStore");
    expect(composition).not.toContain("createInMemoryCandidateSessionStore");
    expect(composition).not.toContain("createTokenCandidateAuthenticator");
    expect(kryterionSimulator).toContain('import { signLegacyExamToken } from "./exam-token";');
  });

  it("imports retired bookExam only from the legacy simulator compatibility module", () => {
    const demoControl = readFileSync("src/api/legacy-simulator-demo-control.ts", "utf8");

    expect(demoControl).toContain(
      'import { bookExam } from "@/legacy-simulator/book-exam";',
    );
    expect(demoControl).not.toContain("@/domain/booking");
  });

  it("does not ship retired /demo route handlers", () => {
    for (const routeFile of retiredDemoRouteFiles) {
      expect(existsSync(routeFile)).toBe(false);
    }

    expect(existsSync("app/demo/page.tsx")).toBe(false);
  });

  it("documents /demo as legacy simulator compatibility instead of an active API module", () => {
    const readme = readFileSync("README.md", "utf8");

    expect(readme).toContain("## Legacy Demo Control Panel");
    expect(readme).toContain("src/api/legacy-simulator-demo-control.ts");
    expect(readme).toContain("legacySimulatorDemo");
    expect(readme).toContain("legacyDemoRuntimeControls");
    expect(readme).toContain("It does not expose the");
    expect(readme).not.toContain("src/api/demo-control.ts");
  });

  it("keeps retired simulator services and deterministic demo controls in separate bundles", () => {
    const composition = readFileSync("src/composition.ts", "utf8");
    const legacyDemoServicesInterface = composition.match(
      /export interface LegacySimulatorDemoServices \{(?<body>[\s\S]*?)\n\}/,
    )?.groups?.body;
    const legacyDemoRuntimeControlsInterface = composition.match(
      /export interface LegacyDemoRuntimeControls \{(?<body>[\s\S]*?)\n\}/,
    )?.groups?.body;
    const servicesInterface = composition.match(
      /export interface Services \{(?<body>[\s\S]*?)\n\}/,
    )?.groups?.body;

    expect(legacyDemoServicesInterface).toBeDefined();
    expect(legacyDemoServicesInterface).toContain("kryterion");
    expect(legacyDemoServicesInterface).toContain("genesys");
    expect(legacyDemoServicesInterface).not.toContain("completedDemoSteps");
    expect(legacyDemoServicesInterface).not.toContain("markStepDone");
    expect(legacyDemoServicesInterface).not.toContain("resetDemo");

    expect(legacyDemoRuntimeControlsInterface).toBeDefined();
    expect(legacyDemoRuntimeControlsInterface).toContain("completedDemoSteps");
    expect(legacyDemoRuntimeControlsInterface).toContain("markStepDone");
    expect(legacyDemoRuntimeControlsInterface).toContain("resetDemo");

    expect(servicesInterface).toBeDefined();
    expect(servicesInterface).toContain("legacySimulatorDemo");
    expect(servicesInterface).toContain("legacyDemoRuntimeControls");
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
    expect(reuseGuard).toContain("legacyDemoRuntimeControls");
    expect(reuseGuard).toContain("completedDemoSteps");
    expect(reuseGuard).toContain("markStepDone");
    expect(reuseGuard).toContain("resetDemo");
  });

  it("builds /demo dependencies from the legacy simulator compatibility bundle", () => {
    const demoControl = readFileSync("src/api/legacy-simulator-demo-control.ts", "utf8");

    expect(demoControl).not.toMatch(/from\s+["']@\/composition["']/);
  });
});
