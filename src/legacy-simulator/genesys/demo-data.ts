import type { GenesysSimulatorData } from "./simulator";

/** Canonical demo identity shared across all demo runs. */
export const DEMO_SEED = {
  candidateId: "cand-001",
  examId: "GCP-ASSOC",
  examTitle: "Genesys Cloud CX: Associate",
} as const;

/**
 * Retired demo catalog and Candidate training records for the legacy Genesys
 * simulator. This is clearly separated demo data, never runtime configuration.
 */
export const genesysDemoData: GenesysSimulatorData = {
  exams: [
    { examId: "GCP-ASSOC", title: "Genesys Cloud CX: Associate", prerequisites: [] },
    {
      examId: "GCP-PRO",
      title: "Genesys Cloud CX: Professional",
      prerequisites: ["course-cx-foundations"],
    },
    {
      examId: "GCP-EXPERT",
      title: "Genesys Cloud CX: Expert",
      prerequisites: ["course-cx-foundations", "course-cx-advanced-routing"],
    },
  ],
  training: [
    { candidateId: "cand-001", completedCourses: ["course-cx-foundations"] },
    {
      candidateId: "cand-002",
      completedCourses: ["course-cx-foundations", "course-cx-advanced-routing"],
    },
  ],
};
