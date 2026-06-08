import { describe, it, expect } from "vitest";
import { createGenesysSimulator } from "./simulator";

const data = {
  exams: [
    { examId: "GCP-001", title: "Genesys Cloud Associate", prerequisites: [] },
    { examId: "GCP-002", title: "Genesys Cloud Professional", prerequisites: ["course-foundations"] },
    { examId: "GCP-003", title: "Genesys Cloud Expert", prerequisites: ["course-foundations", "course-advanced"] },
  ],
  training: [
    { candidateId: "cand-novice", completedCourses: [] },
    { candidateId: "cand-mid", completedCourses: ["course-foundations"] },
    { candidateId: "cand-expert", completedCourses: ["course-foundations", "course-advanced"] },
  ],
};

describe("genesysSimulator.listEligibleExams", () => {
  it("returns only exams whose prerequisites the candidate has completed", async () => {
    const genesys = createGenesysSimulator(data);
    const mid = await genesys.listEligibleExams("cand-mid");
    expect(mid.map((e) => e.examId).sort()).toEqual(["GCP-001", "GCP-002"]);
  });

  it("returns prerequisite-free exams for a candidate with no training", async () => {
    const genesys = createGenesysSimulator(data);
    const novice = await genesys.listEligibleExams("cand-novice");
    expect(novice.map((e) => e.examId)).toEqual(["GCP-001"]);
  });

  it("returns every exam once all prerequisites are met", async () => {
    const genesys = createGenesysSimulator(data);
    const expert = await genesys.listEligibleExams("cand-expert");
    expect(expert.map((e) => e.examId).sort()).toEqual(["GCP-001", "GCP-002", "GCP-003"]);
  });

  it("treats an unknown candidate as having completed no training", async () => {
    const genesys = createGenesysSimulator(data);
    const unknown = await genesys.listEligibleExams("nobody");
    expect(unknown.map((e) => e.examId)).toEqual(["GCP-001"]);
  });

  it("exposes only examId and title (not prerequisites) at the seam", async () => {
    const genesys = createGenesysSimulator(data);
    const [exam] = await genesys.listEligibleExams("cand-novice");
    expect(exam).toEqual({ examId: "GCP-001", title: "Genesys Cloud Associate" });
  });
});
