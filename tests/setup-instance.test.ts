import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { parseEnv } from "node:util";
import { PrismaClient } from "@prisma/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config";
import { createPortalAuthenticator } from "../src/auth/portal-auth";
import { createPortalSessionStore, createPortalUserRepository } from "../src/persistence/portal-auth-repository";

const repo = process.cwd();
const fixtureParent = join(repo, "build", "setup-instance-tests");
let root: string;
let prisma: PrismaClient | undefined;

beforeEach(() => {
  mkdirSync(fixtureParent, { recursive: true });
  root = mkdtempSync(join(fixtureParent, "portal-instance-test-"));
  cpSync(join(repo, "prisma", "schema.prisma"), join(root, "prisma", "schema.prisma"), { recursive: true });
  cpSync(join(repo, "prisma", "migrations"), join(root, "prisma", "migrations"), { recursive: true });
  cpSync(join(repo, ".env.example"), join(root, ".env.example"));
});

afterEach(async () => {
  await prisma?.$disconnect();
  prisma = undefined;
  if (dirname(root) !== fixtureParent || !root.includes("portal-instance-test-")) throw new Error("Unexpected fixture path");
  rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

function setup(...args: string[]) {
  return spawnSync(process.execPath, [
    "--disable-warning=ExperimentalWarning", "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON",
    join(repo, "scripts", "setup-instance.mjs"), ...args,
  ], { cwd: root, encoding: "utf8", timeout: 60_000 });
}

function config() {
  const env = parseEnv(readFileSync(join(root, ".env"), "utf8"));
  return loadConfig({ ...env, PORTAL_SEED_CONFIG_PATH: resolve(root, env.PORTAL_SEED_CONFIG_PATH!) });
}

describe("manual instance setup CLI", () => {
  it("creates an independently keyed baseline whose two admins can sign in through existing auth", async () => {
    const result = setup();
    expect(result.status, result.stderr).toBe(0);
    const created = config();
    expect(created.runtime.mode).toBe("fixture");
    expect(Buffer.from(created.secrets.portalMasterKey, "base64")).toHaveLength(32);
    expect(created.secrets.portalMasterKey).not.toBe(Buffer.alloc(32).toString("base64"));
    expect(created.seed.heliosAdmin!.password).not.toBe(created.seed.certalisSalesAdmin!.password);
    expect(created.seed.heliosCloudShareConnection).toBeNull();
    expect(created.seed.certalisSalesCloudShareConnection).toBeNull();
    prisma = new PrismaClient({ datasources: { db: { url: `file:${join(root, "prisma", "dev.db")}` } } });
    const auth = createPortalAuthenticator({ users: createPortalUserRepository(prisma), sessions: createPortalSessionStore(prisma) });
    const helios = await auth.signIn(created.seed.heliosAdmin!.email, created.seed.heliosAdmin!.password);
    const sales = await auth.signIn(created.seed.certalisSalesAdmin!.email, created.seed.certalisSalesAdmin!.password);
    expect(helios).toMatchObject({ role: "admin", workspace: "certification" });
    expect(sales).toMatchObject({ role: "admin", workspace: "sales" });
    expect(helios.customerId).not.toBe(sales.customerId);
    expect(await prisma.customer.count()).toBe(2);
    expect(await prisma.user.count()).toBe(2);
    expect(await prisma.cloudShareConnection.count()).toBe(0);
    expect(await prisma.salesTrialPortalConfiguration.count()).toBe(1);
    for (const secret of [created.secrets.portalMasterKey, created.seed.heliosAdmin!.password, created.seed.certalisSalesAdmin!.password]) {
      expect(result.stdout + result.stderr).not.toContain(secret);
    }
    expect(existsSync(join(root, "config", "portal-seed.local.json"))).toBe(true);
  }, 90_000);

  it("refuses implicit reruns without changing the existing private files or database", () => {
    expect(setup().status).toBe(0);
    const paths = [".env", "config/portal-seed.local.json", "prisma/dev.db"];
    const before = paths.map(path => readFileSync(join(root, path)));
    const result = setup();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("--reset");
    expect(paths.map(path => readFileSync(join(root, path)))).toEqual(before);
  }, 90_000);

  it("explicitly resets history and credentials while preserving runtime settings and configured identities", async () => {
    expect(setup().status).toBe(0);
    const old = config();
    const seedPath = join(root, "config", "portal-seed.local.json");
    const seed = JSON.parse(readFileSync(seedPath, "utf8"));
    seed.heliosAdminEmail = "preserved-admin@example.invalid";
    seed.heliosInstructor = { id: "configured-instructor", name: "Configured Instructor" };
    writeFileSync(seedPath, JSON.stringify(seed));
    const envPath = join(root, ".env");
    writeFileSync(envPath, readFileSync(envPath, "utf8") +
      '\nPORTAL_MODE=live\nPORTAL_TUNNEL_URL=https://preserved.example.invalid\nUNRELATED_SETTING="keep this # value"\nHELIOS_ADMIN_PASSWORD=old-shared-password\nCLOUDSHARE_V3_API_KEY=old-shared-key\n');
    prisma = new PrismaClient({ datasources: { db: { url: `file:${join(root, "prisma", "dev.db")}` } } });
    const users = createPortalUserRepository(prisma);
    const customer = await users.findCustomerBySlug("helios-cx");
    await users.createUser({ customerId: customer!.id, email: "old-candidate@example.invalid", passwordHash: "old-hash", role: "candidate" });
    await prisma.$disconnect();
    prisma = undefined;
    const result = setup("--reset");
    expect(result.status, result.stderr).toBe(0);
    const fresh = config();
    expect(fresh.runtime.mode).toBe("live");
    expect(fresh.runtime.tunnelUrl).toBe("https://preserved.example.invalid");
    expect(fresh.seed.heliosAdmin!.email).toBe("preserved-admin@example.invalid");
    expect(fresh.seed.heliosInstructor).toEqual(seed.heliosInstructor);
    expect(fresh.secrets.portalMasterKey).not.toBe(old.secrets.portalMasterKey);
    expect(fresh.seed.heliosAdmin!.password).not.toBe(old.seed.heliosAdmin!.password);
    expect(fresh.seed.certalisSalesAdmin!.password).not.toBe(old.seed.certalisSalesAdmin!.password);
    const env = parseEnv(readFileSync(envPath, "utf8"));
    expect(env.UNRELATED_SETTING).toBe("keep this # value");
    expect(env.HELIOS_ADMIN_PASSWORD).toBeUndefined();
    expect(env.CLOUDSHARE_V3_API_KEY).toBeUndefined();
    prisma = new PrismaClient({ datasources: { db: { url: `file:${join(root, "prisma", "dev.db")}` } } });
    expect(await createPortalUserRepository(prisma).findByEmail("old-candidate@example.invalid")).toBeNull();
    expect(await prisma.user.count()).toBe(2);
    expect(result.stdout + result.stderr).not.toContain("old-shared");
  }, 90_000);

  it("refuses to replace a key protecting any stored CloudShare Connection, even with reset", async () => {
    expect(setup().status).toBe(0);
    prisma = new PrismaClient({ datasources: { db: { url: `file:${join(root, "prisma", "dev.db")}` } } });
    const customer = await createPortalUserRepository(prisma).findCustomerBySlug("helios-cx");
    await prisma.cloudShareConnection.create({ data: {
      customerId: customer!.id, apiIdCiphertext: "private-fixture-ciphertext", apiKeyCiphertext: "private-fixture-ciphertext",
      webhookSecretCiphertext: "private-fixture-ciphertext", webhookPathToken: "private-fixture-token",
    } });
    await prisma.$disconnect();
    prisma = undefined;
    const paths = [".env", "config/portal-seed.local.json", "prisma/dev.db"];
    const before = paths.map(path => readFileSync(join(root, path)));
    const result = setup("--reset");
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("CloudShare Connection");
    expect(result.stdout + result.stderr).not.toContain("private-fixture");
    expect(paths.map(path => readFileSync(join(root, path)))).toEqual(before);
  }, 90_000);

  it.each([
    ["custom database", '\nDATABASE_URL=file:./custom.db\n'],
    ["custom seed file", '\nPORTAL_SEED_CONFIG_PATH=./config/custom.local.json\n'],
  ])("refuses unsupported %s paths instead of stranding existing configuration", (_label, setting) => {
    expect(setup().status).toBe(0);
    const envPath = join(root, ".env");
    writeFileSync(envPath, readFileSync(envPath, "utf8") + setting);
    const paths = [".env", "config/portal-seed.local.json", "prisma/dev.db"];
    const before = paths.map(path => readFileSync(join(root, path)));
    const result = setup("--reset");
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("canonical");
    expect(paths.map(path => readFileSync(join(root, path)))).toEqual(before);
  }, 90_000);

  it("leaves the old runtime files intact when a committed migration cannot run", () => {
    expect(setup().status).toBe(0);
    const paths = [".env", "config/portal-seed.local.json", "prisma/dev.db"];
    const before = paths.map(path => readFileSync(join(root, path)));
    const migrations = join(root, "prisma", "migrations");
    const firstMigration = readdirSync(migrations).find(name => name !== "migration_lock.toml")!;
    writeFileSync(join(migrations, firstMigration, "migration.sql"), "INVALID SQL migration-fixture-private-value;");
    const result = setup("--reset");
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("migration");
    expect(result.stdout + result.stderr).not.toContain("migration-fixture-private-value");
    expect(paths.map(path => readFileSync(join(root, path)))).toEqual(before);
    expect(readdirSync(root).some(name => name.startsWith(".setup-instance-"))).toBe(false);
  }, 90_000);

  it.each(["override", "missing prerequisite", "invalid admin", "invalid database"])("refuses %s without replacing the old files", (scenario) => {
    expect(setup().status).toBe(0);
    if (scenario === "override") writeFileSync(join(root, ".env.local"), "PORTAL_MASTER_KEY=old-private-override");
    if (scenario === "missing prerequisite") rmSync(join(root, "prisma", "schema.prisma"));
    if (scenario === "invalid admin") {
      const seedPath = join(root, "config", "portal-seed.local.json");
      const seed = JSON.parse(readFileSync(seedPath, "utf8"));
      seed.certalisSalesAdminEmail = seed.heliosAdminEmail;
      writeFileSync(seedPath, JSON.stringify(seed));
    }
    if (scenario === "invalid database") writeFileSync(join(root, "prisma", "dev.db"), "not a SQLite database");
    const paths = [".env", "config/portal-seed.local.json", "prisma/dev.db"];
    const before = paths.map(path => readFileSync(join(root, path)));
    const result = setup("--reset");
    expect(result.status).toBe(1);
    expect(paths.map(path => readFileSync(join(root, path)))).toEqual(before);
    expect(result.stdout + result.stderr).not.toContain("old-private-override");
  }, 90_000);

  it("preserves Windows path values as read by the actual Next environment loader", () => {
    expect(setup().status).toBe(0);
    const envPath = join(root, ".env");
    writeFileSync(envPath, readFileSync(envPath, "utf8") + '\nREPORTS_DIR=C:\\reports\n');
    const loadReports = () => {
      const nextEnvPath = createRequire(import.meta.url).resolve("@next/env");
      const result = spawnSync(process.execPath, ["-e",
        "process.env={};const {loadEnvConfig}=require(process.argv[1]);process.stdout.write(JSON.stringify(loadEnvConfig(process.cwd()).parsedEnv.REPORTS_DIR));",
        nextEnvPath,
      ], { cwd: root, encoding: "utf8" });
      expect(result.status).toBe(0);
      return JSON.parse(result.stdout);
    };
    expect(loadReports()).toBe("C:\\reports");
    expect(setup("--reset").status).toBe(0);
    expect(loadReports()).toBe("C:\\reports");
  }, 90_000);

  it.skipIf(process.platform !== "win32")("keeps replacement private files restricted to the operator, SYSTEM and Administrators", () => {
    expect(setup().status).toBe(0);
    const privatePaths = [".env", "config/portal-seed.local.json", "prisma/dev.db"].map(path => join(root, path));
    const aclScript = (script: string) => spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")], {
      env: { ...process.env, PORTAL_TEST_ACL_PATHS: JSON.stringify(privatePaths) }, encoding: "utf8", windowsHide: true,
    });
    const restrict = aclScript(`
      $ErrorActionPreference = 'Stop'
      $sid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
      foreach ($path in (ConvertFrom-Json $env:PORTAL_TEST_ACL_PATHS)) {
        & icacls.exe $path /inheritance:r /grant:r "*$($sid):(F)" '*S-1-5-18:(F)' '*S-1-5-32-544:(F)' | Out-Null
        if ($LASTEXITCODE -ne 0) { exit 1 }
      }
    `);
    expect(restrict.status).toBe(0);
    expect(setup("--reset").status).toBe(0);
    const query = aclScript(`
      $ErrorActionPreference = 'Stop'
      $allowed = @([System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value, 'S-1-5-18', 'S-1-5-32-544')
      foreach ($path in (ConvertFrom-Json $env:PORTAL_TEST_ACL_PATHS)) {
        $acl = [System.IO.File]::GetAccessControl($path)
        if (-not $acl.AreAccessRulesProtected) { exit 1 }
        $rules = $acl.GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier])
        if ($rules.Count -ne 3) { exit 1 }
        foreach ($rule in $rules) {
          if ($rule.IdentityReference.Value -notin $allowed -or $rule.AccessControlType -ne 'Allow') { exit 1 }
        }
      }
    `);
    expect(query.status).toBe(0);
  }, 90_000);
});
