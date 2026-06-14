import { describe, it, expect } from "vitest";
import { loadConfig, secretValues, ConfigError } from "./index";

const validEnv = {
  PORTAL_MASTER_KEY: Buffer.alloc(32, 9).toString("base64"),
  CLOUDSHARE_V4_CLIENT_ID: "id",
  CLOUDSHARE_V4_CLIENT_SECRET: "secret",
  CLOUDSHARE_V3_API_ID: "v3id",
  CLOUDSHARE_V3_API_KEY: "v3key",
  CLOUDSHARE_WEBHOOK_SECRET: "whsecret",
  KRYTERION_TOKEN_SECRET: "kryterion-secret",
  PORTAL_MODE: "fixture",
  PORTAL_TUNNEL_URL: "",
  DEMO_BLUEPRINT_NAME: "bp",
  DEMO_POLICY_NAME: "pol",
  DEMO_PROJECT_NAME: "proj",
  DEMO_REGION_NAME: "region",
  DATABASE_URL: "file:./dev.db",
};

describe("loadConfig", () => {
  it("parses a valid environment into the three config categories", () => {
    const config = loadConfig(validEnv);

    expect(config.secrets.cloudshareV4ClientId).toBe("id");
    expect(config.secrets.portalMasterKey).toBe(validEnv.PORTAL_MASTER_KEY);
    expect(config.secrets.webhookSecret).toBe("whsecret");
    expect(config.runtime.mode).toBe("fixture");
    expect(config.demoResources.blueprintName).toBe("bp");
    expect(config.seed.heliosAdminEmail).toBe("admin@helioscx.demo");
  });

  it("throws ConfigError when a required secret is missing", () => {
    const { PORTAL_MASTER_KEY, ...incomplete } = validEnv;
    expect(() => loadConfig(incomplete)).toThrow(ConfigError);
  });

  it("throws ConfigError when PORTAL_MODE is not a known mode", () => {
    expect(() => loadConfig({ ...validEnv, PORTAL_MODE: "banana" })).toThrow(
      ConfigError,
    );
  });
});

describe("secretValues", () => {
  it("includes databaseUrl so Postgres credentials are redacted from logs", () => {
    const config = loadConfig({
      ...validEnv,
      DATABASE_URL: "postgresql://user:password@host/db",
    });
    const values = secretValues(config);
    expect(values).toContain("postgresql://user:password@host/db");
  });

  it("includes all secret fields", () => {
    const config = loadConfig(validEnv);
    const values = secretValues(config);
    expect(values).toContain("secret");
    expect(values).toContain(validEnv.PORTAL_MASTER_KEY);
    expect(values).toContain("whsecret");
    expect(values).toContain("kryterion-secret");
  });
});
