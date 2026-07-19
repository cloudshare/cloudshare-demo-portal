import { describe, expect, it } from "vitest";
import { projectProtectedRequestHeaders } from "./protected-request-headers";

describe("projectProtectedRequestHeaders", () => {
  it("masks credential aliases regardless of punctuation or concatenation", () => {
    expect(projectProtectedRequestHeaders({
      "X-Authorization": "one",
      "CloudShare-Authorization": "two",
      "X-AuthToken": "three",
      XAuthToken: "four",
      "X-AccessToken": "five",
      "X-CloudShareApiKey": "six",
      "Ocp-Apim-Subscription-Key": "seven",
      "X-Access-Key": "eight",
      "X-Signature256": "nine",
      Cookie2: "ten",
    })).toEqual({
      "X-Authorization": "[REDACTED]",
      "CloudShare-Authorization": "[REDACTED]",
      "X-AuthToken": "[REDACTED]",
      XAuthToken: "[REDACTED]",
      "X-AccessToken": "[REDACTED]",
      "X-CloudShareApiKey": "[REDACTED]",
      "Ocp-Apim-Subscription-Key": "[REDACTED]",
      "X-Access-Key": "[REDACTED]",
      "X-Signature256": "[REDACTED]",
      Cookie2: "[REDACTED]",
    });
  });

  it("preserves safe operational headers and masks tuple and scalar shapes conservatively", () => {
    expect(projectProtectedRequestHeaders({
      "Content-Type": "application/json",
      Accept: "application/json",
      "Content-Length": "42",
      "User-Agent": "agent",
      "X-Correlation-ID": "corr",
      "X-Request-ID": "req",
      "X-Retry-Count": "2",
    })).toEqual({
      "Content-Type": "application/json",
      Accept: "application/json",
      "Content-Length": "42",
      "User-Agent": "agent",
      "X-Correlation-ID": "corr",
      "X-Request-ID": "req",
      "X-Retry-Count": "2",
    });
    expect(projectProtectedRequestHeaders([["X-Access-Key", "secret"], ["Accept", "text/plain"]])).toEqual([["X-Access-Key", "[REDACTED]"], ["Accept", "text/plain"]]);
    expect(projectProtectedRequestHeaders("unstructured secret headers")).toBe("[REDACTED]");
  });
});
