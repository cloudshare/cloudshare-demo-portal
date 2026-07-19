import { describe, expect, it } from "vitest";
import {
  CLOUDSHARE_RATE_LIMIT_ERROR_DISCRIMINANT,
  CloudShareRateLimitError,
  isCloudShareRateLimitError,
} from "./errors";

describe("isCloudShareRateLimitError", () => {
  it("accepts class instances and branded cross-realm values with the required shape", () => {
    expect(isCloudShareRateLimitError(new CloudShareRateLimitError("limited", 429, "rate_limit"))).toBe(true);
    expect(isCloudShareRateLimitError({
      name: "CloudShareRateLimitError",
      cloudShareErrorDiscriminant: CLOUDSHARE_RATE_LIMIT_ERROR_DISCRIMINANT,
      status: 429,
      classification: "rate_limit",
      context: { status: 429 },
    })).toBe(true);
  });

  it.each([
    { name: "CloudShareRateLimitError" },
    { name: "CloudShareRateLimitError", cloudShareErrorDiscriminant: CLOUDSHARE_RATE_LIMIT_ERROR_DISCRIMINANT, status: "429", classification: "rate_limit" },
    { name: "CloudShareRateLimitError", cloudShareErrorDiscriminant: CLOUDSHARE_RATE_LIMIT_ERROR_DISCRIMINANT, status: 429, classification: "provider-text" },
  ])("rejects unbranded or invalid lookalikes", (value) => {
    expect(isCloudShareRateLimitError(value)).toBe(false);
  });
});
