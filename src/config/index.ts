import { z } from "zod";

/**
 * Typed runtime configuration for the portal, organised into three categories:
 *  - secrets:       sensitive credentials, env-only and redacted in logs
 *  - runtime:       operational flags (live-vs-fixture mode, tunnel URL)
 *  - demoResources: friendly names for the CloudShare resources the demo uses
 *
 * Config is validated at boot via {@link loadConfig}; the app fails fast if the
 * environment is missing or malformed rather than failing mid-demo.
 */

/** Raised when the environment cannot be parsed into a valid {@link Config}. */
export class ConfigError extends Error {
  constructor(message: string, readonly issues?: string[]) {
    super(message);
    this.name = "ConfigError";
  }
}

const envSchema = z.object({
  // Category 1 — secrets
  CLOUDSHARE_V4_CLIENT_ID: z.string().min(1),
  CLOUDSHARE_V4_CLIENT_SECRET: z.string().min(1),
  CLOUDSHARE_V3_API_ID: z.string().min(1),
  CLOUDSHARE_V3_API_KEY: z.string().min(1),
  CLOUDSHARE_WEBHOOK_SECRET: z.string().min(1),

  // Category 2 — runtime flags
  PORTAL_MODE: z.enum(["live", "fixture"]),
  PORTAL_TUNNEL_URL: z.string().optional().default(""),

  // Category 3 — demo resource selection
  DEMO_BLUEPRINT_NAME: z.string().min(1),
  DEMO_POLICY_NAME: z.string().min(1),
  DEMO_PROJECT_NAME: z.string().min(1),
  DEMO_REGION_NAME: z.string().min(1),

  // Persistence
  DATABASE_URL: z.string().min(1),
});

export type PortalMode = z.infer<typeof envSchema>["PORTAL_MODE"];

export interface Config {
  readonly secrets: {
    readonly cloudshareV4ClientId: string;
    readonly cloudshareV4ClientSecret: string;
    readonly cloudshareV3ApiId: string;
    readonly cloudshareV3ApiKey: string;
    readonly webhookSecret: string;
  };
  readonly runtime: {
    readonly mode: PortalMode;
    readonly tunnelUrl: string;
  };
  readonly demoResources: {
    readonly blueprintName: string;
    readonly policyName: string;
    readonly projectName: string;
    readonly regionName: string;
  };
  readonly databaseUrl: string;
}

/**
 * Parse and validate an environment record into a typed {@link Config}.
 * Throws {@link ConfigError} (fail fast) if anything required is missing or invalid.
 */
export function loadConfig(env: NodeJS.ProcessEnv | Record<string, unknown>): Config {
  const result = envSchema.safeParse(env);
  if (!result.success) {
    const issues = result.error.issues.map(
      (i) => `${i.path.join(".") || "(root)"}: ${i.message}`,
    );
    throw new ConfigError(
      `Invalid portal configuration:\n${issues.join("\n")}`,
      issues,
    );
  }

  const e = result.data;
  return {
    secrets: {
      cloudshareV4ClientId: e.CLOUDSHARE_V4_CLIENT_ID,
      cloudshareV4ClientSecret: e.CLOUDSHARE_V4_CLIENT_SECRET,
      cloudshareV3ApiId: e.CLOUDSHARE_V3_API_ID,
      cloudshareV3ApiKey: e.CLOUDSHARE_V3_API_KEY,
      webhookSecret: e.CLOUDSHARE_WEBHOOK_SECRET,
    },
    runtime: {
      mode: e.PORTAL_MODE,
      tunnelUrl: e.PORTAL_TUNNEL_URL,
    },
    demoResources: {
      blueprintName: e.DEMO_BLUEPRINT_NAME,
      policyName: e.DEMO_POLICY_NAME,
      projectName: e.DEMO_PROJECT_NAME,
      regionName: e.DEMO_REGION_NAME,
    },
    databaseUrl: e.DATABASE_URL,
  };
}

/** The set of secret values that must never appear in logs. */
export function secretValues(config: Config): string[] {
  return [...Object.values(config.secrets), config.databaseUrl].filter((v) => v.length > 0);
}
