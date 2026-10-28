import { salesCancellationFixture } from "./sales-cancellation-fixture";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { CloudShareFixtureError } from "./errors";
import type { HttpClient, HttpResponse } from "./http";

/**
 * Fixture-mode transport. Recorded CloudShare responses are replayed through the
 * same {@link HttpClient} seam the live client uses, so the adapter's auth,
 * request-building, and Zod validation run identically against canned data.
 * These fixtures double as the demo-mode replay corpus.
 *
 * Lookups key on `METHOD pathname` only — v3's signed query string (token,
 * timestamp, HMAC) varies per call and must not affect which fixture matches.
 */

export type FixtureMap = Record<string, HttpResponse>;

const fixtureFileSchema = z.object({
  method: z.enum(["GET", "POST", "PUT", "DELETE"]),
  path: z.string().startsWith("/"),
  status: z.number().int().positive(),
  /** Recorded JSON body, stored as a value and re-serialised on replay. */
  body: z.unknown(),
});

function keyFor(method: string, pathname: string): string {
  return `${method} ${pathname}`;
}

/** Build a fixture-backed HTTP client from an in-memory map. */
export function createFixtureHttpClient(fixtures: FixtureMap): HttpClient {
  return {
    async send(request): Promise<HttpResponse> {
      const synthetic = await salesCancellationFixture(request);
      if (synthetic) return synthetic;
      const { pathname } = new URL(request.url);
      const key = keyFor(request.method, pathname);
      const fixture = fixtures[key];
      if (!fixture) {
        throw new CloudShareFixtureError(`No fixture recorded for "${key}"`, {
          key,
          available: Object.keys(fixtures),
        });
      }
      return fixture;
    },
  };
}

/**
 * Validate raw fixture records (from disk or static imports) into a {@link FixtureMap}.
 * `label` is only used to make validation errors point at the offending source.
 */
export function buildFixtureMap(
  rawFixtures: Iterable<{ raw: unknown; label: string }>,
): FixtureMap {
  const map: FixtureMap = {};
  for (const { raw, label } of rawFixtures) {
    const parsed = fixtureFileSchema.safeParse(raw);
    if (!parsed.success) {
      throw new CloudShareFixtureError(`Invalid fixture "${label}"`, {
        issues: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
      });
    }
    const { method, path, status, body } = parsed.data;
    map[keyFor(method, path)] = { status, body: JSON.stringify(body) };
  }
  return map;
}

/** Load and validate every `*.json` fixture in a directory into a {@link FixtureMap}. */
export function loadFixturesFromDir(dir: string): FixtureMap {
  return buildFixtureMap(
    readdirSync(dir)
      .filter((file) => file.endsWith(".json"))
      .map((file) => ({ raw: JSON.parse(readFileSync(join(dir, file), "utf8")), label: file })),
  );
}
