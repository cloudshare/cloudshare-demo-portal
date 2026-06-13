import { createHash, randomUUID } from "node:crypto";

/**
 * CloudShare v3 (Production) `cs_sha1` request signing.
 *
 * Each v3 request is authenticated with four parameters derived per-call:
 *  - `UserApiId`  — the public API id (not secret).
 *  - `Timestamp`  — UNIX seconds; the signature is valid for ~60s server-side.
 *  - `Token`      — a single-use random nonce, unique per request.
 *  - `HMAC`       — `sha1(apiKey + fullUrl + timestamp + token)` as lowercase hex.
 *
 * The api key is the shared secret folded into the hashed string (CloudShare's
 * documented `cs_sha1` scheme); it is never sent on the wire. This is the ~20-line
 * reimplementation called for in Slice 2 — no SDK dependency.
 *
 * NOTE (assumption to verify against a live v3 call): the four params are applied
 * as query-string parameters, the documented v3 mechanism. Because every v3
 * request goes through this single seam, only this module changes if the exact
 * wire placement differs.
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
 * real clock and a random UUID; tests inject deterministic versions.
 */
export function signV3Request(opts: SignV3Options): V3AuthParams {
  const now = opts.now ?? Date.now;
  const newToken = opts.newToken ?? (() => randomUUID());

  const timestamp = Math.floor(now() / 1000).toString();
  const token = newToken();
  const hmac = csSha1Hash({
    apiKey: opts.apiKey,
    fullUrl: opts.fullUrl,
    timestamp,
    token,
  });

  return { UserApiId: opts.apiId, Timestamp: timestamp, Token: token, HMAC: hmac };
}
