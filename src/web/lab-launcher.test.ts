import { describe, it, expect } from "vitest";
import { parseLaunchResponse } from "./lab-launcher";

describe("parseLaunchResponse", () => {
  it("extracts loginUrl and environmentExternalId from a well-formed response", () => {
    const json = {
      examAttemptId: "ea-1",
      loginUrl: "https://classic.cloudshare.com/login?t=abc",
      environmentExternalId: "env-ext-xyz",
    };

    expect(parseLaunchResponse(json)).toEqual({
      loginUrl: "https://classic.cloudshare.com/login?t=abc",
      environmentExternalId: "env-ext-xyz",
    });
  });

  it("throws when loginUrl is missing", () => {
    expect(() => parseLaunchResponse({ environmentExternalId: "env-ext-xyz" })).toThrow(
      /loginUrl/,
    );
  });

  it("throws when environmentExternalId is missing", () => {
    expect(() =>
      parseLaunchResponse({ loginUrl: "https://classic.cloudshare.com/login?t=abc" }),
    ).toThrow(/environmentExternalId/);
  });
});
