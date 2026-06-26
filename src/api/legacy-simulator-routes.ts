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
