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
      "X-Password": "eleven",
      "X-Auth-Password": "twelve",
      "X-Api-Secret-Key": "thirteen",
      "X-Session-ID": "fourteen",
      "X-Webhook-Signature-SHA256": "fifteen",
      "X-CloudShare-Signature-V1": "sixteen",
      "X-HMAC-Signature-V1": "seventeen",
      "X-Session-Token-ID": "eighteen",
      "X-Auth-Nonce": "nineteen",
      "X-Custom-Unknown": "twenty",
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
      "X-Password": "[REDACTED]",
      "X-Auth-Password": "[REDACTED]",
      "X-Api-Secret-Key": "[REDACTED]",
      "X-Session-ID": "[REDACTED]",
      "X-Webhook-Signature-SHA256": "[REDACTED]",
      "X-CloudShare-Signature-V1": "[REDACTED]",
      "X-HMAC-Signature-V1": "[REDACTED]",
      "X-Session-Token-ID": "[REDACTED]",
      "X-Auth-Nonce": "[REDACTED]",
      "X-Custom-Unknown": "[REDACTED]",
    });
  });

  it("preserves safe operational headers and masks tuple and scalar shapes conservatively", () => {
    expect(projectProtectedRequestHeaders({
      "Content-Type": "application/json",
      Accept: "application/json",
      "Accept-Encoding": "gzip",
      "Content-Length": "42",
      "User-Agent": "agent",
      "X-Correlation-ID": "corr",
      "X-Request-ID": "req",
      traceparent: "00-trace-parent",
      tracestate: "vendor=value",
    })).toEqual({
      "Content-Type": "application/json",
      Accept: "application/json",
      "Accept-Encoding": "gzip",
      "Content-Length": "42",
      "User-Agent": "agent",
      "X-Correlation-ID": "corr",
      "X-Request-ID": "req",
      traceparent: "00-trace-parent",
      tracestate: "vendor=value",
    });
    expect(projectProtectedRequestHeaders([["X-Access-Key", "secret"], ["Accept", "text/plain"]])).toEqual([["X-Access-Key", "[REDACTED]"], ["Accept", "text/plain"]]);
    expect(projectProtectedRequestHeaders("unstructured secret headers")).toBe("[REDACTED]");
    expect(projectProtectedRequestHeaders("Content-Type: application/json")).toBe("Content-Type: application/json");
    expect(projectProtectedRequestHeaders("Authorization: Bearer secret")).toBe("Authorization: [REDACTED]");
  });
});
