import { describe, it, expect } from "vitest";
import { csSha1Hash, signV3Request } from "./signing";

describe("csSha1Hash", () => {
  // Pinned known vector: sha1(apiKey + fullUrl + timestamp + token), hex.
  // Locks the exact CloudShare v3 `cs_sha1` concatenation + digest so a future
  // refactor can't silently change the wire signature.
  it("matches the known vector for a fixed input", () => {
    const hash = csSha1Hash({
      apiKey: "test-api-key",
      fullUrl: "https://use.cloudshare.com/api/v3/projects",
      timestamp: "1700000000",
      token: "fixed-token-123",
    });
    expect(hash).toBe("f3638be273be615a4eee47a650d72cc4a8388ac2");
  });

  it("changes when any single input changes", () => {
    const base = {
      apiKey: "k",
      fullUrl: "https://x/api/v3/a",
      timestamp: "1",
      token: "t",
    };
    const h = csSha1Hash(base);
    expect(csSha1Hash({ ...base, apiKey: "k2" })).not.toBe(h);
    expect(csSha1Hash({ ...base, fullUrl: "https://x/api/v3/b" })).not.toBe(h);
    expect(csSha1Hash({ ...base, timestamp: "2" })).not.toBe(h);
    expect(csSha1Hash({ ...base, token: "t2" })).not.toBe(h);
  });
});

describe("signV3Request", () => {
  it("builds auth params from injected clock and token generator", () => {
    const params = signV3Request({
      apiId: "api-id-1",
      apiKey: "test-api-key",
      fullUrl: "https://use.cloudshare.com/api/v3/projects",
      now: () => 1_700_000_000_000, // ms → 1700000000 s
      newToken: () => "fixed-token-123",
    });

    expect(params.UserApiId).toBe("api-id-1");
    expect(params.Timestamp).toBe("1700000000");
    expect(params.Token).toBe("fixed-token-123");
    expect(params.HMAC).toBe("f3638be273be615a4eee47a650d72cc4a8388ac2");
  });

  it("produces a fresh single-use token and current timestamp per call", () => {
    let t = 0;
    const tokens = ["tok-a", "tok-b"];
    const sign = () =>
      signV3Request({
        apiId: "id",
        apiKey: "key",
        fullUrl: "https://use.cloudshare.com/api/v3/ping",
        now: () => (t += 1000),
        newToken: () => tokens.shift() ?? "exhausted",
      });

    const first = sign();
    const second = sign();
    expect(first.Token).toBe("tok-a");
    expect(second.Token).toBe("tok-b");
    expect(first.Timestamp).not.toBe(second.Timestamp);
    expect(first.HMAC).not.toBe(second.HMAC);
  });
});
