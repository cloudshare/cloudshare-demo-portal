import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
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
  PORTAL_SEED_SOURCE: z.enum(["off", "env", "file"]).optional().default("env"),
  PORTAL_SEED_CONFIG_PATH: z.string().optional().default("./config/portal-seed.local.json"),

  // Category 3 — demo resource selection
  DEMO_BLUEPRINT_NAME: z.string().optional().default(""),
  DEMO_POLICY_NAME: z.string().optional().default(""),
  DEMO_PROJECT_NAME: z.string().optional().default(""),
  DEMO_REGION_NAME: z.string().optional().default(""),

  // Seeded Helios admin login for the demo.
  HELIOS_ADMIN_EMAIL: z.string().email().optional(),
  HELIOS_ADMIN_PASSWORD: z.string().min(8).optional(),
  HELIOS_SEED_CLOUDSHARE_API_ID: z.string().optional().default(""),
  HELIOS_SEED_CLOUDSHARE_API_KEY: z.string().optional().default(""),
  HELIOS_SEED_CLOUDSHARE_WEBHOOK_SECRET: z.string().optional().default(""),
  HELIOS_SEED_CLOUDSHARE_INSTRUCTOR_ID: z.string().optional(),
  HELIOS_SEED_CLOUDSHARE_INSTRUCTOR_NAME: z.string().optional(),

  // Legacy admin bearer token (deprecated by Slice 1 login, tolerated for
  // unfinished slices that still assume it exists).
  ADMIN_TOKEN: z.string().optional().default(""),

  // Persistence
  DATABASE_URL: z.string().min(1),
});

export type PortalMode = z.infer<typeof envSchema>["PORTAL_MODE"];
export type PortalSeedSource = z.infer<typeof envSchema>["PORTAL_SEED_SOURCE"];

const seedConnectionSchema = z
  .object({
    apiId: z.string().min(1),
    apiKey: z.string().min(1),
    webhookSecret: z.string().min(1),
  })
  .nullable()
  .default(null);

const seedFileSchema = z.object({
  heliosAdminEmail: z.string().email(),
  heliosAdminPassword: z.string().min(8),
  heliosCloudShareConnection: seedConnectionSchema,
  heliosInstructor: z.object({
    id: z.string().min(1),
    name: z.string().min(1),
  }),
});

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
    readonly seedSource: PortalSeedSource;
  };
  readonly demoResources: {
    readonly blueprintName: string;
    readonly policyName: string;
    readonly projectName: string;
    readonly regionName: string;
  };
  readonly seed: {
    readonly source: PortalSeedSource;
    readonly configPath: string | null;
    readonly heliosAdmin:
      | {
          readonly email: string;
          readonly password: string;
        }
      | null;
    readonly heliosCloudShareConnection:
      | {
          readonly apiId: string;
          readonly apiKey: string;
          readonly webhookSecret: string;
        }
      | null;
    readonly heliosInstructor:
      | {
          readonly id: string;
          readonly name: string;
        }
      | null;
  };
  readonly databaseUrl: string;
}

function parseJsonFile(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8"));
}

function resolveSeedConfig(
  env: z.infer<typeof envSchema>,
): Config["seed"] {
  if (env.PORTAL_SEED_SOURCE === "off") {
    return {
      source: "off",
      configPath: null,
      heliosAdmin: null,
      heliosCloudShareConnection: null,
      heliosInstructor: null,
    };
  }

  if (env.PORTAL_SEED_SOURCE === "env") {
    if (
      !env.HELIOS_ADMIN_EMAIL ||
      !env.HELIOS_ADMIN_PASSWORD ||
      !env.HELIOS_SEED_CLOUDSHARE_INSTRUCTOR_ID ||
      !env.HELIOS_SEED_CLOUDSHARE_INSTRUCTOR_NAME
    ) {
      throw new ConfigError(
        "Invalid portal configuration:\nSeed source 'env' requires HELIOS_ADMIN_EMAIL, HELIOS_ADMIN_PASSWORD, HELIOS_SEED_CLOUDSHARE_INSTRUCTOR_ID, and HELIOS_SEED_CLOUDSHARE_INSTRUCTOR_NAME",
      );
    }

    return {
      source: "env",
      configPath: null,
      heliosAdmin: {
        email: env.HELIOS_ADMIN_EMAIL,
        password: env.HELIOS_ADMIN_PASSWORD,
      },
      heliosCloudShareConnection:
        env.HELIOS_SEED_CLOUDSHARE_API_ID &&
        env.HELIOS_SEED_CLOUDSHARE_API_KEY &&
        env.HELIOS_SEED_CLOUDSHARE_WEBHOOK_SECRET
          ? {
              apiId: env.HELIOS_SEED_CLOUDSHARE_API_ID,
              apiKey: env.HELIOS_SEED_CLOUDSHARE_API_KEY,
              webhookSecret: env.HELIOS_SEED_CLOUDSHARE_WEBHOOK_SECRET,
            }
          : null,
      heliosInstructor: {
        id: env.HELIOS_SEED_CLOUDSHARE_INSTRUCTOR_ID,
        name: env.HELIOS_SEED_CLOUDSHARE_INSTRUCTOR_NAME,
      },
    };
  }

  const configPath = resolve(process.cwd(), env.PORTAL_SEED_CONFIG_PATH);
  if (!existsSync(configPath)) {
    throw new ConfigError(
      `Invalid portal configuration:\nSeed source 'file' requires an existing config file at ${configPath}`,
    );
  }

  const parsed = seedFileSchema.safeParse(parseJsonFile(configPath));
  if (!parsed.success) {
    const issues = parsed.error.issues.map(
      (issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`,
    );
    throw new ConfigError(
      `Invalid portal seed config file (${configPath}):\n${issues.join("\n")}`,
      issues,
    );
  }

  return {
    source: "file",
    configPath,
    heliosAdmin: {
      email: parsed.data.heliosAdminEmail,
      password: parsed.data.heliosAdminPassword,
    },
    heliosCloudShareConnection: parsed.data.heliosCloudShareConnection,
    heliosInstructor: parsed.data.heliosInstructor,
  };
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
      seedSource: e.PORTAL_SEED_SOURCE,
    },
    demoResources: {
      blueprintName: e.DEMO_BLUEPRINT_NAME,
      policyName: e.DEMO_POLICY_NAME,
      projectName: e.DEMO_PROJECT_NAME,
      regionName: e.DEMO_REGION_NAME,
    },
    seed: resolveSeedConfig(e),
    databaseUrl: e.DATABASE_URL,
  };
}

/** The set of secret values that must never appear in logs. */
export function secretValues(config: Config): string[] {
  return [
    ...Object.values(config.secrets),
    config.databaseUrl,
    config.seed.heliosAdmin?.password ?? "",
    config.seed.heliosCloudShareConnection?.apiId ?? "",
    config.seed.heliosCloudShareConnection?.apiKey ?? "",
    config.seed.heliosCloudShareConnection?.webhookSecret ?? "",
  ].filter(Boolean);
}
