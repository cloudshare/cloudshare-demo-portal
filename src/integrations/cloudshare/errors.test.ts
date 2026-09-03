import { describe, expect, it } from "vitest";
import {
  CLOUDSHARE_ERROR_DISCRIMINANT,
  CLOUDSHARE_RATE_LIMIT_ERROR_DISCRIMINANT,
  CloudShareRequestError,
  CloudShareRateLimitError,
  isCloudShareErrorAcrossBoundaries,
  isCloudShareRateLimitError,
} from "./errors";

describe("isCloudShareErrorAcrossBoundaries", () => {
  it("accepts class instances and branded cross-module values", () => {
    expect(isCloudShareErrorAcrossBoundaries(new CloudShareRequestError("failed", 504))).toBe(true);
    expect(isCloudShareErrorAcrossBoundaries({
      name: "CloudShareRequestError",
      cloudShareErrorBoundaryDiscriminant: CLOUDSHARE_ERROR_DISCRIMINANT,
      status: 504,
      context: { path: "/oauth/token" },
    })).toBe(true);
  });

  it("rejects unbranded and malformed lookalikes", () => {
    expect(isCloudShareErrorAcrossBoundaries({
      name: "CloudShareRequestError",
      status: 504,
      context: { path: "/oauth/token" },
    })).toBe(false);
    expect(isCloudShareErrorAcrossBoundaries({
      name: "CloudShareRequestError",
      cloudShareErrorBoundaryDiscriminant: CLOUDSHARE_ERROR_DISCRIMINANT,
      status: "504",
    })).toBe(false);
  });
});

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
