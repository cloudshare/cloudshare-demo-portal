/**
 * Demo Control Panel domain types and step-gating logic.
 *
 * The panel presents the happy path as a linear sequence of ordered steps.
 * Each step becomes "available" only when its predecessor has been marked done.
 * Steps that require real environment state (suspend, resume) additionally gate
 * on the live environment status reported by the EnvironmentStateSource.
 */

// --- Seed data ---

/** Canonical demo identity used across all demo runs. */
export const DEMO_SEED = {
  candidateId: "cand-001",
  examId: "GCP-ASSOC",
  examTitle: "Genesys Cloud CX: Associate",
} as const;

// --- Step types ---

export type DemoStep =
  | "book_exam"
  | "launch_lab"
  | "suspend_exam"
  | "resume_exam"
  | "retrieve_score";

export const DEMO_STEPS: readonly DemoStep[] = [
  "book_exam",
  "launch_lab",
  "suspend_exam",
  "resume_exam",
  "retrieve_score",
];

export type StepStatus = "pending" | "available" | "done";

export interface StepMeta {
  readonly id: DemoStep;
  readonly label: string;
  readonly description: string;
}

export const STEP_META: Record<DemoStep, StepMeta> = {
  book_exam: {
    id: "book_exam",
    label: "1. Book Exam",
    description: "Register the demo candidate for the certification exam.",
  },
  launch_lab: {
    id: "launch_lab",
    label: "2. Launch Lab",
    description: "Provision a CloudShare lab environment for this exam attempt.",
  },
  suspend_exam: {
    id: "suspend_exam",
    label: "3. Suspend Exam",
    description: "Suspend the lab environment and pause the Kryterion exam timer.",
  },
  resume_exam: {
    id: "resume_exam",
    label: "4. Resume Exam",
    description: "Resume the lab environment and restart the exam timer.",
  },
  retrieve_score: {
    id: "retrieve_score",
    label: "5. Retrieve Score",
    description: "Fetch Guided Journey progress from CloudShare.",
  },
};

// --- Gating logic ---

export interface DemoGates {
  /** Whether an ExamAttempt exists for the demo seed candidate+exam. */
  readonly examAttemptExists: boolean;
  /** Whether a LabLaunch exists for the current ExamAttempt. */
  readonly labLaunchExists: boolean;
  /** Current environment status, or null if no environment record yet. */
  readonly environmentStatus: string | null;
  /** Which steps have been explicitly completed in this demo session. */
  readonly completedSteps: ReadonlySet<DemoStep>;
}

/**
 * Pure function — maps the current demo gates to a status for every step.
 * No side effects. Drives the panel rendering and the pre-execute guard.
 */
export function computeStepStatuses(gates: DemoGates): Record<DemoStep, StepStatus> {
  const done = (step: DemoStep): boolean => gates.completedSteps.has(step);
  const { examAttemptExists, labLaunchExists, environmentStatus } = gates;

  return {
    book_exam: done("book_exam") ? "done" : "available",

    launch_lab: done("launch_lab") ? "done"
      : examAttemptExists ? "available"
      : "pending",

    suspend_exam: done("suspend_exam") ? "done"
      : labLaunchExists && environmentStatus === "running" ? "available"
      : "pending",

    resume_exam: done("resume_exam") ? "done"
      : done("suspend_exam") && environmentStatus === "suspended" ? "available"
      : "pending",

    retrieve_score: done("retrieve_score") ? "done"
      : done("resume_exam") ? "available"
      : "pending",
  };
}
