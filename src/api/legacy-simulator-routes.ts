export const retiredLegacySimulatorExamFlowResponse = {
  error: {
    code: "legacy_simulator_exam_flow_retired",
    message: "The retired simulator exam booking API is no longer active.",
    replacements: {
      catalog: "GET /api/candidate/exams",
      scheduling: "POST /api/candidate/exams",
    },
  },
} as const;

export const retiredLegacyTokenCandidateAdmissionResponse = {
  error: {
    code: "legacy_token_candidate_admission_retired",
    message: "The retired token-based Candidate admission API is no longer active.",
    replacements: {
      login: "POST /api/auth/login",
      session: "GET /api/auth/session",
      catalog: "GET /api/candidate/exams",
    },
  },
} as const;
