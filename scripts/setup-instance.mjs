// Node 24: manual, offline setup. Never import application composition here.
import { randomBytes } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { parseEnv } from 'node:util';
import { DatabaseSync } from 'node:sqlite';

const require = createRequire(import.meta.url);
let stage;
let replacing = false;
let phase = 'prerequisites';
let refusal = '';
try {
  if (Number(process.versions.node.split('.')[0]) < 24) throw new Error();
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === '--help') {
    process.stdout.write('Usage: npm run setup:instance [-- --reset]\nNode 24 required. Stop the application first. Back up runtime files outside the future image before --reset.\nPrivate output: .env, config/portal-seed.local.json, prisma/dev.db. No credentials are printed.\n');
    process.exit(0);
  }
  if (args.length > 1 || (args.length === 1 && args[0] !== '--reset')) throw new Error();
  const root = process.cwd();
  const ownedPaths = ['.env', 'config/portal-seed.local.json', 'prisma/dev.db'];
  const existingDb = join(root, 'prisma', 'dev.db');
  if (['.env.local', '.env.production', '.env.production.local', '.env.development', '.env.development.local']
      .some(path => existsSync(join(root, path)))) {
    refusal = 'Environment override files are unsupported. Resolve them before setup; no runtime files were replaced.';
    throw new Error();
  }
  if ([...ownedPaths, 'config', 'prisma'].some(path => existsSync(join(root, path)) && lstatSync(join(root, path)).isSymbolicLink())) throw new Error();
  if (['-wal', '-shm', '-journal'].some(suffix => existsSync(existingDb + suffix))) {
    refusal = 'SQLite sidecar files found. Stop the application and resolve its database state before setup.';
    throw new Error();
  }
  const env = parseEnv(readFileSync(join(root, existsSync(join(root, '.env')) ? '.env' : '.env.example'), 'utf8'));
  if ((env.DATABASE_URL && env.DATABASE_URL !== 'file:./dev.db') ||
      (env.PORTAL_SEED_CONFIG_PATH && resolve(root, env.PORTAL_SEED_CONFIG_PATH) !== join(root, 'config', 'portal-seed.local.json'))) {
    refusal = 'Setup supports only canonical .env, config/portal-seed.local.json and prisma/dev.db paths; no runtime files were replaced.';
    throw new Error();
  }
  if (existsSync(existingDb)) {
    const db = new DatabaseSync(existingDb, { readOnly: true, timeout: 3000 });
    try {
      db.exec('PRAGMA query_only = ON');
      if (db.prepare('SELECT COUNT(*) AS count FROM CloudShareConnection').get().count > 0) {
        refusal = 'Stored CloudShare Connection found. Setup cannot replace its encryption key; no runtime files were replaced.';
        throw new Error();
      }
    } finally { db.close(); }
  }
  if (args[0] !== '--reset' && ownedPaths.some(path => existsSync(join(root, path)))) {
    refusal = 'Existing runtime files require explicit --reset after an external backup.';
    throw new Error();
  }
  const oldSeed = env.PORTAL_SEED_SOURCE === 'file' && existsSync(join(root, 'config', 'portal-seed.local.json'))
    ? JSON.parse(readFileSync(join(root, 'config', 'portal-seed.local.json'), 'utf8')) : {};
  const fileSeed = env.PORTAL_SEED_SOURCE === 'file';
  const heliosEmail = (fileSeed ? oldSeed.heliosAdminEmail : env.HELIOS_ADMIN_EMAIL) || 'helios-admin@example.invalid';
  const salesEmail = (fileSeed ? oldSeed.certalisSalesAdminEmail : env.CERTALIS_SALES_ADMIN_EMAIL) || 'sales-admin@certalis.demo';
  const instructor = (fileSeed ? oldSeed.heliosInstructor :
    env.HELIOS_SEED_CLOUDSHARE_INSTRUCTOR_ID && env.HELIOS_SEED_CLOUDSHARE_INSTRUCTOR_NAME
      ? { id: env.HELIOS_SEED_CLOUDSHARE_INSTRUCTOR_ID, name: env.HELIOS_SEED_CLOUDSHARE_INSTRUCTOR_NAME } : null)
    ?? { id: 'fixture-instructor', name: 'Fixture Instructor' };
  const { z } = await import('zod');
  z.email().parse(heliosEmail);
  z.email().parse(salesEmail);
  if (heliosEmail.toLowerCase() === salesEmail.toLowerCase()) throw new Error();
  z.object({ id: z.string().min(1), name: z.string().min(1) }).parse(instructor);
  env.PORTAL_MODE ??= 'fixture';
  z.enum(['live', 'fixture']).parse(env.PORTAL_MODE);
  if (env.PORTAL_BACKGROUND_JOBS !== undefined) z.enum(['enabled', 'disabled']).parse(env.PORTAL_BACKGROUND_JOBS);
  if (env.HEARTBEAT_TIMEOUT_MS !== undefined) z.coerce.number().int().positive().parse(env.HEARTBEAT_TIMEOUT_MS);
  for (const key of [
    'CLOUDSHARE_V4_CLIENT_ID', 'CLOUDSHARE_V4_CLIENT_SECRET', 'CLOUDSHARE_V3_API_ID', 'CLOUDSHARE_V3_API_KEY', 'CLOUDSHARE_WEBHOOK_SECRET',
    'HELIOS_ADMIN_EMAIL', 'HELIOS_ADMIN_PASSWORD', 'CERTALIS_SALES_ADMIN_EMAIL', 'CERTALIS_SALES_ADMIN_PASSWORD', 'ADMIN_TOKEN',
    'HELIOS_SEED_CLOUDSHARE_API_ID', 'HELIOS_SEED_CLOUDSHARE_API_KEY', 'HELIOS_SEED_CLOUDSHARE_WEBHOOK_SECRET',
    'HELIOS_SEED_CLOUDSHARE_INSTRUCTOR_ID', 'HELIOS_SEED_CLOUDSHARE_INSTRUCTOR_NAME',
  ]) delete env[key];
  env.PORTAL_MASTER_KEY = randomBytes(32).toString('base64');
  env.PORTAL_SEED_SOURCE = 'file';
  env.PORTAL_SEED_CONFIG_PATH = './config/portal-seed.local.json';
  env.DATABASE_URL = 'file:./dev.db';
  const seed = {
    heliosAdminEmail: heliosEmail,
    heliosAdminPassword: randomBytes(24).toString('base64url'),
    certalisSalesAdminEmail: salesEmail,
    certalisSalesAdminPassword: randomBytes(24).toString('base64url'),
    heliosInstructor: instructor,
    heliosCloudShareConnection: null,
    certalisSalesCloudShareConnection: null,
  };
  const { PrismaClient } = await import('@prisma/client');
  const { applyPortalSeed } = await import('../src/config/portal-seeding.ts');
  const { hashPassword } = await import('../src/auth/password.ts');
  const { createPortalUserRepository } = await import('../src/persistence/portal-auth-repository.ts');
  const prismaCli = require.resolve('prisma/build/index.js');
  stage = mkdtempSync(join(root, '.setup-instance-'));
  const stagedDb = join(stage, 'instance.db');
  const stagedDatabaseUrl = `file:${stagedDb.replaceAll('\\', '/')}`;
  const prisma = new PrismaClient({ datasources: { db: { url: stagedDatabaseUrl } } });
  writeFileSync(stagedDb, '', { mode: 0o600 });
  phase = 'migration';
  execFileSync(process.execPath, [prismaCli, 'migrate', 'deploy', '--schema', join(root, 'prisma', 'schema.prisma')], {
    cwd: root, env: { ...process.env, DATABASE_URL: stagedDatabaseUrl }, stdio: 'pipe', timeout: 60_000,
  });
  phase = 'seeding';
  try {
    await applyPortalSeed({
      portalUsers: createPortalUserRepository(prisma), hashPassword,
      // Both connection inputs below are null; setup must never create provider credentials.
      cloudshareConnections: { async findByCustomerId() { throw new Error(); }, async save() { throw new Error(); } },
    }, {
      heliosAdmin: { email: seed.heliosAdminEmail, password: seed.heliosAdminPassword },
      certalisSalesAdmin: { email: seed.certalisSalesAdminEmail, password: seed.certalisSalesAdminPassword },
      heliosCloudShareConnection: null, certalisSalesCloudShareConnection: null,
    });
  } finally { await prisma.$disconnect(); }
  writeFileSync(join(stage, 'seed.json'), JSON.stringify(seed, null, 2) + '\n', { mode: 0o600 });
  writeFileSync(join(stage, 'env'), Object.entries(env).map(([key, value]) => {
    // Keep the parsed value exactly, including comments/quotes inside a value.
    const encoded = [`"${value}"`, `'${value}'`, `\`${value}\``, value].find(candidate => {
      const parsed = parseEnv(`${key}=${candidate}\n`);
      return Object.keys(parsed).length === 1 && parsed[key] === value;
    });
    if (encoded === undefined) throw new Error();
    return `${key}=${encoded}`;
  }).join('\n') + '\n', { mode: 0o600 });
  mkdirSync(join(root, 'config'), { recursive: true });
  replacing = true;
  renameSync(stagedDb, join(root, 'prisma', 'dev.db'));
  renameSync(join(stage, 'seed.json'), join(root, 'config', 'portal-seed.local.json'));
  renameSync(join(stage, 'env'), join(root, '.env'));
  process.stdout.write('Instance initialized. Private configuration: .env and config/portal-seed.local.json. Two admin accounts are ready.\n');
} catch {
  process.stderr.write(refusal ? `${refusal}\n` : replacing
    ? 'Instance setup failed during file replacement. Restore the external backup before starting the application.\n'
    : `Instance setup failed during ${phase}; existing runtime files were not replaced.\n`);
  process.exitCode = 1;
} finally {
  // stage is created by mkdtemp directly beneath the supplied working directory.
  try { if (stage) rmSync(stage, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }); }
  catch {
    process.stderr.write('Private setup staging files remain. Remove the .setup-instance-* directory before preparing an image.\n');
    process.exitCode = 1;
  }
}
