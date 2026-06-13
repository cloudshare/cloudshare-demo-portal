import { createHash, randomInt } from "node:crypto";

/**
 * CloudShare v3 (Production) `cs_sha1` request signing.
 *
 * Each v3 request is authenticated with four parameters derived per-call:
 *  - `UserApiId`  — the public API id (not secret).
 *  - `Timestamp`  — UNIX seconds; the signature is valid for ~60s server-side.
 *  - `Token`      — a single-use 10-character alphanumeric nonce.
 *  - `HMAC`       — `sha1(apiKey + fullUrl + timestamp + token)` as lowercase hex.
 *
 * The api key is the shared secret folded into the hashed string (CloudShare's
 * documented `cs_sha1` scheme); it is never sent on the wire. This is the ~20-line
 * reimplementation called for in Slice 2 — no SDK dependency.
 *
 * CloudShare expects these params in the `Authorization` request header, prefixed
 * with `cs_sha1`.
 */

export interface CsSha1Input {
  readonly apiKey: string;
  readonly fullUrl: string;
  readonly timestamp: string;
  readonly token: string;
}

/** Compute the `cs_sha1` signature: lowercase-hex sha1 of the concatenated string. */
export function csSha1Hash({ apiKey, fullUrl, timestamp, token }: CsSha1Input): string {
  return createHash("sha1")
    .update(apiKey + fullUrl + timestamp + token)
    .digest("hex");
}

export interface V3AuthParams {
  readonly UserApiId: string;
  readonly Timestamp: string;
  readonly Token: string;
  readonly HMAC: string;
}

const ALPHANUMERIC = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
const V3_TOKEN_PATTERN = /^[A-Za-z0-9]{10}$/;

function randomAlphaNumericToken(length = 10): string {
  let token = "";
  for (let i = 0; i < length; i += 1) {
    token += ALPHANUMERIC[randomInt(ALPHANUMERIC.length)];
  }
  return token;
}

function assertValidV3Token(token: string): void {
  if (!V3_TOKEN_PATTERN.test(token)) {
    throw new Error(
      "CloudShare v3 token must be exactly 10 alphanumeric characters",
    );
  }
}

export function buildV3AuthorizationHeader(auth: V3AuthParams): string {
  return [
    "cs_sha1",
    `userapiid:${auth.UserApiId};timestamp:${auth.Timestamp};token:${auth.Token};hmac:${auth.HMAC}`,
  ].join(" ");
}

export interface SignV3Options {
  readonly apiId: string;
  readonly apiKey: string;
  /** The full request URL the signature is bound to. */
  readonly fullUrl: string;
  /** Current time in epoch milliseconds. Injectable for deterministic tests. */
  readonly now?: () => number;
  /** Generates the single-use token. Injectable for deterministic tests. */
  readonly newToken?: () => string;
}

/**
 * Produce the per-request v3 auth parameters. `now`/`newToken` default to the
 * real clock and a Postman-compatible 10-character alphanumeric token; tests
 * inject deterministic versions.
 */
export function signV3Request(opts: SignV3Options): V3AuthParams {
  const now = opts.now ?? Date.now;
  const newToken = opts.newToken ?? randomAlphaNumericToken;

  const timestamp = Math.floor(now() / 1000).toString();
  const token = newToken();
  assertValidV3Token(token);
  const hmac = csSha1Hash({
    apiKey: opts.apiKey,
    fullUrl: opts.fullUrl,
    timestamp,
    token,
  });

  return { UserApiId: opts.apiId, Timestamp: timestamp, Token: token, HMAC: hmac };
}
