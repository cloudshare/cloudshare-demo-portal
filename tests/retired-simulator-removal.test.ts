import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { describe, expect, it } from "vitest";

const retiredArtifacts = [
  "src/legacy-simulator",
  "src/domain/demo-control.ts",
  "src/api/legacy-simulator-demo-control.ts",
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

describe("retired simulator removal", () => {
  it("does not ship the retired simulator or demo-control implementation", () => {
    for (const artifact of retiredArtifacts) {
      expect(existsSync(artifact)).toBe(false);
    }
  });

  it("keeps retired simulator dependencies out of active source", () => {
    const activeSources = listSourceFiles("src")
      .map((file) => readFileSync(file, "utf8"))
      .join("\n");

    expect(activeSources).not.toContain("@/legacy-simulator/");
    expect(activeSources).not.toMatch(/\b(?:Genesys|Kryterion|proctoring)\b/i);
  });

  it("keeps composition limited to active portal services", () => {
    const composition = readFileSync("src/composition.ts", "utf8");

    expect(composition).not.toContain("legacySimulatorDemo");
    expect(composition).not.toContain("legacyDemoRuntimeControls");
    expect(composition).not.toContain("createGenesysSimulator");
    expect(composition).not.toContain("createKryterionSimulator");
  });

  it("keeps the active suspend/resume boundary on the ExamAttempt runtime lifecycle", () => {
    expect(existsSync("src/domain/exam-attempt-runtime-lifecycle.ts")).toBe(true);

    const suspendResumeRuntime = readFileSync(
      "src/api/exam-attempt-suspend-resume-runtime.ts",
      "utf8",
    );

    expect(suspendResumeRuntime).toContain(
      'from "@/domain/exam-attempt-runtime-lifecycle";',
    );
  });
});
