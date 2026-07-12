import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, it, expect } from "vitest";
import { loadConfig, secretValues, ConfigError } from "./index";

const validEnv = {
  PORTAL_MASTER_KEY: Buffer.alloc(32, 9).toString("base64"),
  CLOUDSHARE_V4_CLIENT_ID: "id",
  CLOUDSHARE_V4_CLIENT_SECRET: "secret",
  CLOUDSHARE_V3_API_ID: "v3id",
  CLOUDSHARE_V3_API_KEY: "v3key",
  CLOUDSHARE_WEBHOOK_SECRET: "whsecret",
  PORTAL_MODE: "fixture",
  PORTAL_TUNNEL_URL: "",
  PORTAL_SEED_SOURCE: "env",
  HELIOS_ADMIN_EMAIL: "admin@helioscx.demo",
  HELIOS_ADMIN_PASSWORD: "HeliosDemo123!",
  HELIOS_SEED_CLOUDSHARE_INSTRUCTOR_ID: "instructor-1",
  HELIOS_SEED_CLOUDSHARE_INSTRUCTOR_NAME: "Helios Service Account",
  CERTALIS_SALES_ADMIN_EMAIL: "sales-admin@certalis.demo",
  CERTALIS_SALES_ADMIN_PASSWORD: "CertalisTestPassword123!",
  DATABASE_URL: "file:./dev.db",
};

describe("loadConfig", () => {
  it("parses a valid environment into the three config categories", () => {
    const config = loadConfig(validEnv);

    expect(config.secrets.cloudshareV4ClientId).toBe("id");
    expect(config.secrets.portalMasterKey).toBe(validEnv.PORTAL_MASTER_KEY);
    expect(config.secrets.webhookSecret).toBe("whsecret");
    expect(config.runtime.mode).toBe("fixture");
    expect(config.runtime.seedSource).toBe("env");
    expect(config.seed.heliosAdmin?.email).toBe("admin@helioscx.demo");
    expect(config.seed.heliosInstructor?.id).toBe("instructor-1");
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

  it("loads the seed from a local JSON config file when PORTAL_SEED_SOURCE=file", () => {
    const dir = mkdtempSync(join(tmpdir(), "portal-seed-"));
    const path = join(dir, "portal-seed.local.json");
    writeFileSync(
      path,
      JSON.stringify(
        {
          heliosAdminEmail: "file-admin@helioscx.demo",
          heliosAdminPassword: "FileSeed123!",
          heliosCloudShareConnection: {
            apiId: "file-api-id",
            apiKey: "file-api-key",
            webhookSecret: "file-whsec",
          },
          heliosInstructor: {
            id: "file-instructor",
            name: "File Service Account",
          },
          certalisSalesAdminEmail: "file-sales-admin@certalis.demo",
          certalisSalesAdminPassword: "FileCertalisPassword123!",
        },
        null,
        2,
      ),
    );

    try {
      const config = loadConfig({
        ...validEnv,
        PORTAL_SEED_SOURCE: "file",
        PORTAL_SEED_CONFIG_PATH: path,
        HELIOS_ADMIN_EMAIL: undefined,
        HELIOS_ADMIN_PASSWORD: undefined,
        HELIOS_SEED_CLOUDSHARE_INSTRUCTOR_ID: undefined,
        HELIOS_SEED_CLOUDSHARE_INSTRUCTOR_NAME: undefined,
      });

      expect(config.seed.source).toBe("file");
      expect(config.seed.heliosAdmin?.email).toBe("file-admin@helioscx.demo");
      expect(config.seed.heliosCloudShareConnection?.apiKey).toBe("file-api-key");
      expect(config.seed.heliosInstructor?.name).toBe("File Service Account");
      expect(config.seed.certalisSalesAdmin?.email).toBe(
        "file-sales-admin@certalis.demo",
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("requires an explicit Sales Admin password for environment seeds", () => {
    expect(() =>
      loadConfig({
        ...validEnv,
        CERTALIS_SALES_ADMIN_PASSWORD: undefined,
      }),
    ).toThrow(
      "CERTALIS_SALES_ADMIN_EMAIL and CERTALIS_SALES_ADMIN_PASSWORD",
    );
  });

  it("rejects a file seed without a Sales Admin password", () => {
    const dir = mkdtempSync(join(tmpdir(), "portal-seed-"));
    const path = join(dir, "portal-seed.local.json");
    writeFileSync(
      path,
      JSON.stringify({
        heliosAdminEmail: "file-admin@helioscx.demo",
        heliosAdminPassword: "FileSeed123!",
        heliosCloudShareConnection: null,
        heliosInstructor: {
          id: "file-instructor",
          name: "File Service Account",
        },
        certalisSalesAdminEmail: "file-sales-admin@certalis.demo",
      }),
    );

    try {
      expect(() =>
        loadConfig({
          ...validEnv,
          PORTAL_SEED_SOURCE: "file",
          PORTAL_SEED_CONFIG_PATH: path,
        }),
      ).toThrow(ConfigError);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("allows seeding to be explicitly disabled", () => {
    const config = loadConfig({
      ...validEnv,
      PORTAL_SEED_SOURCE: "off",
      HELIOS_ADMIN_EMAIL: undefined,
      HELIOS_ADMIN_PASSWORD: undefined,
      HELIOS_SEED_CLOUDSHARE_INSTRUCTOR_ID: undefined,
      HELIOS_SEED_CLOUDSHARE_INSTRUCTOR_NAME: undefined,
    });

    expect(config.seed.source).toBe("off");
    expect(config.seed.heliosAdmin).toBeNull();
    expect(config.seed.heliosInstructor).toBeNull();
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
  });
});
