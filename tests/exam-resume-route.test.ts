import { describe, expect, it } from "vitest";
import { POST } from "../app/api/exam/resume/route";

describe("POST /api/exam/resume", () => {
  it("is retired so no sponsored-link loginUrl can leak through JSON", async () => {
    const response = await POST();
    const body = await response.json();

    expect(response.status).toBe(410);
    expect(body).toEqual({
      error: "Exam resume must use the time-gated /enter redirect.",
    });
    expect(JSON.stringify(body)).not.toContain("loginUrl");
  });
});
