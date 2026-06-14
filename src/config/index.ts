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
  PORTAL_MASTER_KEY: z.string().min(1),
  CLOUDSHARE_V4_CLIENT_ID: z.string().optional().default(""),
  CLOUDSHARE_V4_CLIENT_SECRET: z.string().optional().default(""),
  CLOUDSHARE_V3_API_ID: z.string().optional().default(""),
  CLOUDSHARE_V3_API_KEY: z.string().optional().default(""),
  CLOUDSHARE_WEBHOOK_SECRET: z.string().optional().default(""),
  // Kryterion (simulator) exam-token signing secret — HMAC key shared between
  // the simulator that mints candidate tokens and the auth layer that verifies them.
  KRYTERION_TOKEN_SECRET: z.string().min(1),

  // Category 2 — runtime flags
  PORTAL_MODE: z.enum(["live", "fixture"]),
  PORTAL_TUNNEL_URL: z.string().optional().default(""),
  HEARTBEAT_TIMEOUT_MS: z.coerce.number().int().positive().optional().default(60_000),

  // Category 3 — demo resource selection
  DEMO_BLUEPRINT_NAME: z.string().optional().default(""),
  DEMO_POLICY_NAME: z.string().optional().default(""),
  DEMO_PROJECT_NAME: z.string().optional().default(""),
  DEMO_REGION_NAME: z.string().optional().default(""),

  // Seeded Helios admin login for the demo.
  HELIOS_ADMIN_EMAIL: z.string().email().optional().default("admin@helioscx.demo"),
  HELIOS_ADMIN_PASSWORD: z.string().min(8).optional().default("HeliosDemo123!"),
  HELIOS_SEED_CLOUDSHARE_API_ID: z.string().optional().default(""),
  HELIOS_SEED_CLOUDSHARE_API_KEY: z.string().optional().default(""),
  HELIOS_SEED_CLOUDSHARE_WEBHOOK_SECRET: z.string().optional().default(""),
  HELIOS_SEED_CLOUDSHARE_INSTRUCTOR_ID: z.string().optional().default("seeded-cloudshare-instructor"),
  HELIOS_SEED_CLOUDSHARE_INSTRUCTOR_NAME: z.string().optional().default("Seeded CloudShare Instructor"),

  // Legacy admin bearer token (deprecated by Slice 1 login, tolerated for
  // unfinished slices that still assume it exists).
  ADMIN_TOKEN: z.string().optional().default(""),

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
    readonly portalMasterKey: string;
    readonly kryterionTokenSecret: string;
    readonly adminToken: string;
  };
  readonly runtime: {
    readonly mode: PortalMode;
    readonly tunnelUrl: string;
    /** Milliseconds without a client heartbeat before the server auto-suspends the lab. */
    readonly heartbeatTimeoutMs: number;
  };
  readonly demoResources: {
    readonly blueprintName: string;
    readonly policyName: string;
    readonly projectName: string;
    readonly regionName: string;
  };
  readonly seed: {
    readonly heliosAdminEmail: string;
    readonly heliosAdminPassword: string;
    readonly heliosCloudShareConnection:
      | {
          readonly apiId: string;
          readonly apiKey: string;
          readonly webhookSecret: string;
        }
      | null;
    readonly heliosInstructor: {
      readonly id: string;
      readonly name: string;
    };
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
      portalMasterKey: e.PORTAL_MASTER_KEY,
      cloudshareV4ClientId: e.CLOUDSHARE_V4_CLIENT_ID,
      cloudshareV4ClientSecret: e.CLOUDSHARE_V4_CLIENT_SECRET,
      cloudshareV3ApiId: e.CLOUDSHARE_V3_API_ID,
      cloudshareV3ApiKey: e.CLOUDSHARE_V3_API_KEY,
      webhookSecret: e.CLOUDSHARE_WEBHOOK_SECRET,
      kryterionTokenSecret: e.KRYTERION_TOKEN_SECRET,
      adminToken: e.ADMIN_TOKEN,
    },
    runtime: {
      mode: e.PORTAL_MODE,
      tunnelUrl: e.PORTAL_TUNNEL_URL,
      heartbeatTimeoutMs: e.HEARTBEAT_TIMEOUT_MS,
    },
    demoResources: {
      blueprintName: e.DEMO_BLUEPRINT_NAME,
      policyName: e.DEMO_POLICY_NAME,
      projectName: e.DEMO_PROJECT_NAME,
      regionName: e.DEMO_REGION_NAME,
    },
    seed: {
      heliosAdminEmail: e.HELIOS_ADMIN_EMAIL,
      heliosAdminPassword: e.HELIOS_ADMIN_PASSWORD,
      heliosCloudShareConnection:
        e.HELIOS_SEED_CLOUDSHARE_API_ID &&
        e.HELIOS_SEED_CLOUDSHARE_API_KEY &&
        e.HELIOS_SEED_CLOUDSHARE_WEBHOOK_SECRET
          ? {
              apiId: e.HELIOS_SEED_CLOUDSHARE_API_ID,
              apiKey: e.HELIOS_SEED_CLOUDSHARE_API_KEY,
              webhookSecret: e.HELIOS_SEED_CLOUDSHARE_WEBHOOK_SECRET,
            }
          : null,
      heliosInstructor: {
        id: e.HELIOS_SEED_CLOUDSHARE_INSTRUCTOR_ID,
        name: e.HELIOS_SEED_CLOUDSHARE_INSTRUCTOR_NAME,
      },
    },
    databaseUrl: e.DATABASE_URL,
  };
}

/** The set of secret values that must never appear in logs. */
export function secretValues(config: Config): string[] {
  return [...Object.values(config.secrets), config.databaseUrl].filter(Boolean);
}
