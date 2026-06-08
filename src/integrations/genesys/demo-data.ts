import type { GenesysSimulatorData } from "./simulator";

/**
 * Demo catalog and candidate training records for the Genesys simulator. This is
 * clearly-separated demo data, never production configuration — believable
 * Genesys-style certification exams gated behind prerequisite training courses.
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
