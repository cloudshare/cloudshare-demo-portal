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

  it("requires exact canonical header punctuation and valid allowlisted value shapes", () => {
    expect(projectProtectedRequestHeaders({
      "content-TYPE": "application/json",
      ContentType: "bypass",
      Content_Type: "bypass",
      "Content@Type": "bypass",
      "Con!tent-Type": "bypass",
      "Accept!": "bypass",
      UserAgent: "bypass",
      XRequestID: "bypass",
      "Trace-Parent": "bypass",
      Accept: ["application/json", "text/plain"],
      "Content-Type": { authorization: "Bearer secret" },
      "Content-Length": 42,
      "User-Agent": true,
      "X-Correlation-ID": null,
      "X-Request-ID": ["valid", 42],
      traceparent: { token: "secret" },
    })).toEqual({
      "content-TYPE": "application/json",
      ContentType: "[REDACTED]",
      Content_Type: "[REDACTED]",
      "Content@Type": "[REDACTED]",
      "Con!tent-Type": "[REDACTED]",
      "Accept!": "[REDACTED]",
      UserAgent: "[REDACTED]",
      XRequestID: "[REDACTED]",
      "Trace-Parent": "[REDACTED]",
      Accept: ["application/json", "text/plain"],
      "Content-Type": "[REDACTED]",
      "Content-Length": "[REDACTED]",
      "User-Agent": "[REDACTED]",
      "X-Correlation-ID": "[REDACTED]",
      "X-Request-ID": "[REDACTED]",
      traceparent: "[REDACTED]",
    });
    expect(projectProtectedRequestHeaders([["Content-Type", { authorization: "secret" }], ["Accept", ["application/json"]]])).toEqual([["Content-Type", "[REDACTED]"], ["Accept", ["application/json"]]]);
    expect(projectProtectedRequestHeaders("ContentType: application/json")).toBe("ContentType: [REDACTED]");
    expect(projectProtectedRequestHeaders("Content-Type: application/json\nAuthorization: secret")).toBe("[REDACTED]");
  });

  it("rejects whitespace-padded names and control characters in allowlisted values", () => {
    expect(projectProtectedRequestHeaders({
      "Content-Type": "application/json",
      " Content-Type": "bypass",
      "Content-Type ": "bypass",
      "\tAccept": "bypass",
      Accept: "application/json\r\nAuthorization: Bearer secret",
      "Accept-Encoding": ["gzip", "br\r\nX-Secret: value"],
      "User-Agent": "agent\0secret",
    })).toEqual({
      "Content-Type": "application/json",
      " Content-Type": "[REDACTED]",
      "Content-Type ": "[REDACTED]",
      "\tAccept": "[REDACTED]",
      Accept: "[REDACTED]",
      "Accept-Encoding": "[REDACTED]",
      "User-Agent": "[REDACTED]",
    });
    expect(projectProtectedRequestHeaders([[" Content-Type", "application/json"], ["Content-Type", "application/json\u0001secret"]])).toEqual([[" Content-Type", "[REDACTED]"], ["Content-Type", "[REDACTED]"]]);
    expect(projectProtectedRequestHeaders(" Content-Type: application/json")).toBe(" Content-Type: [REDACTED]");
    expect(projectProtectedRequestHeaders("Content-Type : application/json")).toBe("Content-Type : [REDACTED]");
  });
});
