import { describe, expect, it } from "vitest";
import { POST } from "../app/api/exam/resume/route";

describe("POST /api/exam/resume", () => {
  it("rejects invalid input without leaking the sponsored loginUrl", async () => {
    const response = await POST(
      new Request("http://localhost/api/exam/resume", {
        method: "POST",
        body: JSON.stringify({}),
        headers: {
          "content-type": "application/json",
        },
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toEqual({ error: "examAttemptId is required" });
    expect(JSON.stringify(body)).not.toContain("loginUrl");
  });
});
