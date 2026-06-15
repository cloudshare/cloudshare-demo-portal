import { describe, expect, it } from "vitest";
import { POST } from "../app/api/lab/launch/route";

describe("POST /api/lab/launch", () => {
  it("does not expose sponsored-link loginUrl through the retired launch endpoint", async () => {
    const response = await POST();
    const body = await response.json();

    expect(response.status).toBe(410);
    expect(body).toEqual({
      error: "Lab launch must use the time-gated /enter redirect.",
    });
    expect(JSON.stringify(body)).not.toContain("loginUrl");
  });
});
