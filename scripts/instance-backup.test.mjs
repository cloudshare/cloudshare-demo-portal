import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { createSecretBox } from '../src/security/secret-box.ts';
import { hashPassword, verifyPassword } from '../src/auth/password.ts';

const cli = fileURLToPath(new URL('./instance-backup.mjs', import.meta.url));
const repo = dirname(dirname(cli));
const require = createRequire(import.meta.url);

function run(root, ...args) {
  return spawnSync(process.execPath, [cli, ...args], { cwd: root, encoding: 'utf8', timeout: 60_000 });
}

function instance(root) {
  mkdirSync(join(root, 'config'), { recursive: true });
  mkdirSync(join(root, 'prisma'));
  cpSync(join(repo, 'prisma', 'schema.prisma'), join(root, 'prisma', 'schema.prisma'));
  cpSync(join(repo, 'prisma', 'migrations'), join(root, 'prisma', 'migrations'), { recursive: true });
  writeFileSync(join(root, 'package.json'), '{"name":"cloudshare-demo-portal","version":"0.1.0"}\n');
  writeFileSync(join(root, '.gitignore'), '.env\nconfig/*.local.json\nprisma/*.db*\n');
  const env = 'DATABASE_URL=file:./dev.db\nPORTAL_MASTER_KEY=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=\nPORTAL_MODE=fixture\nPORTAL_SEED_SOURCE=file\nPORTAL_SEED_CONFIG_PATH=./config/portal-seed.local.json\n';
  const seed = JSON.stringify({ heliosAdminEmail: 'admin@example.invalid', heliosAdminPassword: 'fixture-password',
    certalisSalesAdminEmail: 'sales@example.invalid', certalisSalesAdminPassword: 'fixture-sales-password',
    heliosInstructor: { id: 'fixture', name: 'Fixture Instructor' }, heliosCloudShareConnection: null });
  writeFileSync(join(root, '.env'), env);
  writeFileSync(join(root, 'config', 'portal-seed.local.json'), seed);
  execFileSync(process.execPath, [require.resolve('prisma/build/index.js'), 'migrate', 'deploy', '--schema', join(root, 'prisma', 'schema.prisma')], {
    cwd: root, env: { ...process.env, DATABASE_URL: `file:${join(root, 'prisma', 'dev.db').replaceAll('\\', '/')}` }, stdio: 'pipe', timeout: 60_000,
  });
  for (const args of [['init'], ['add', '.'], ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-m', 'Fixture source']]) {
    execFileSync('git', args, { cwd: root, stdio: 'pipe' });
  }
  return { env, seed };
}

test('create rejects an incomplete instance without publishing a backup or exposing configuration', () => {
  const root = mkdtempSync(join(tmpdir(), 'portal-backup-test-'));
  const destination = `${root}-backup`;
  const secret = 'fixture-private-value-must-not-be-printed';
  const env = `PORTAL_MASTER_KEY=${secret}\nDATABASE_URL=file:./dev.db\n`;
  try {
    writeFileSync(join(root, '.env'), env);
    const result = spawnSync(process.execPath, [cli, 'create', destination], {
      cwd: root, encoding: 'utf8', timeout: 30_000,
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Incomplete instance/);
    assert.equal(existsSync(destination), false);
    assert.equal(readFileSync(join(root, '.env'), 'utf8'), env);
    assert.equal((result.stdout + result.stderr).includes(secret), false);
  } finally {
    // Both paths are direct children of the OS temporary directory, allocated by this test.
    for (const path of [root, destination]) {
      assert.equal(dirname(path), dirname(root));
      assert.ok(path.startsWith(join(tmpdir(), 'portal-backup-test-')));
      rmSync(path, { recursive: true, force: true, maxRetries: 3 });
    }
  }
});

test('create and verify retain committed WAL records and exact private configuration in a standalone artifact', () => {
  const root = mkdtempSync(join(tmpdir(), 'portal-backup-test-'));
  const destination = `${root}-backup`;
  let db;
  try {
    const { env, seed } = instance(root);
    db = new DatabaseSync(join(root, 'prisma', 'dev.db'));
    db.exec('PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0');
    db.prepare('INSERT INTO Heartbeat (id, source, createdAt) VALUES (?, ?, ?)').run('preserved-record', 'WAL fixture', 0);
    assert.ok(existsSync(join(root, 'prisma', 'dev.db-wal')));
    const created = run(root, 'create', destination);
    assert.equal(created.status, 0, created.stderr);
    assert.equal(readFileSync(join(destination, 'portal.env'), 'utf8'), env);
    assert.equal(readFileSync(join(destination, 'portal-seed.json'), 'utf8'), seed);
    const saved = new DatabaseSync(join(destination, 'database.sqlite'), { readOnly: true });
    try { assert.equal(saved.prepare('SELECT source FROM Heartbeat WHERE id=?').get('preserved-record').source, 'WAL fixture'); }
    finally { saved.close(); }
    const verified = run(root, 'verify', destination);
    assert.equal(verified.status, 0, verified.stderr);
    assert.equal(JSON.parse(readFileSync(join(destination, 'manifest.json'), 'utf8')).formatVersion, 1);
    assert.equal((created.stdout + created.stderr + verified.stdout + verified.stderr).includes('fixture-password'), false);
  } finally {
    db?.close();
    for (const path of [root, destination]) {
      assert.equal(dirname(path), dirname(root));
      assert.ok(path.startsWith(join(tmpdir(), 'portal-backup-test-')));
      rmSync(path, { recursive: true, force: true, maxRetries: 3 });
    }
  }
});

test('restore rejects corrupt input and stale target sidecars, then restores matched records, credentials and configuration', async () => {
  const root = mkdtempSync(join(tmpdir(), 'portal-backup-test-'));
  const destination = `${root}-backup`;
  try {
    const { env, seed } = instance(root);
    const secrets = createSecretBox(Buffer.alloc(32));
    const passwordHash = await hashPassword('preserved-password');
    const db = new DatabaseSync(join(root, 'prisma', 'dev.db'));
    try {
      db.prepare('INSERT INTO Customer (id, slug, name) VALUES (?, ?, ?)').run('customer', 'retained', 'Retained Customer');
      db.prepare('INSERT INTO User (id, customerId, email, passwordHash, role) VALUES (?, ?, ?, ?, ?)').run('user', 'customer', 'retained@example.invalid', passwordHash, 'admin');
      db.prepare('INSERT INTO CloudShareConnection (id, customerId, apiIdCiphertext, apiKeyCiphertext, webhookSecretCiphertext, webhookPathToken, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run('connection', 'customer', secrets.encrypt('saved-api-id'), secrets.encrypt('saved-api-key'), secrets.encrypt('saved-webhook-secret'), 'saved-path', 0);
    } finally { db.close(); }
    const created = run(root, 'create', destination);
    assert.equal(created.status, 0, created.stderr);
    const artifactEnv = readFileSync(join(destination, 'portal.env'));
    writeFileSync(join(destination, 'portal.env'), 'corrupt');
    const paths = ['.env', 'config/portal-seed.local.json', 'prisma/dev.db'];
    const before = paths.map(path => readFileSync(join(root, path)));
    const corrupt = run(root, 'restore', destination);
    assert.equal(corrupt.status, 1);
    assert.match(corrupt.stderr, /integrity mismatch/);
    assert.deepEqual(paths.map(path => readFileSync(join(root, path))), before);
    writeFileSync(join(destination, 'portal.env'), artifactEnv);
    writeFileSync(join(root, 'prisma', 'dev.db-wal'), 'stale');
    const stale = run(root, 'restore', destination);
    assert.equal(stale.status, 1);
    assert.match(stale.stderr, /sidecar/);
    rmSync(join(root, 'prisma', 'dev.db-wal'));
    const changed = new DatabaseSync(join(root, 'prisma', 'dev.db'));
    try { changed.prepare('UPDATE User SET passwordHash=?').run('replaced'); } finally { changed.close(); }
    writeFileSync(join(root, '.env'), env.replace('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=', Buffer.alloc(32, 1).toString('base64')));
    writeFileSync(join(root, 'config', 'portal-seed.local.json'), '{}');
    const restored = run(root, 'restore', destination);
    assert.equal(restored.status, 0, restored.stderr);
    assert.equal(readFileSync(join(root, '.env'), 'utf8'), env);
    assert.equal(readFileSync(join(root, 'config', 'portal-seed.local.json'), 'utf8'), seed);
    const saved = new DatabaseSync(join(root, 'prisma', 'dev.db'), { readOnly: true });
    try {
      assert.equal(await verifyPassword('preserved-password', saved.prepare('SELECT passwordHash FROM User WHERE id=?').get('user').passwordHash), true);
      const connection = saved.prepare('SELECT apiIdCiphertext, apiKeyCiphertext, webhookSecretCiphertext FROM CloudShareConnection').get();
      assert.deepEqual(Object.values(connection).map(value => secrets.decrypt(value)), ['saved-api-id', 'saved-api-key', 'saved-webhook-secret']);
    } finally { saved.close(); }
    assert.equal((restored.stdout + restored.stderr).includes('saved-api-key'), false);
  } finally {
    for (const path of [root, destination]) {
      assert.equal(dirname(path), dirname(root));
      assert.ok(path.startsWith(join(tmpdir(), 'portal-backup-test-')));
      rmSync(path, { recursive: true, force: true, maxRetries: 3 });
    }
  }
});

test('restore migrates only deliberately in staging and recovers original matched state after a failed migration', () => {
  const root = mkdtempSync(join(tmpdir(), 'portal-backup-test-'));
  const destination = `${root}-backup`;
  const commit = () => {
    execFileSync('git', ['add', '.'], { cwd: root, stdio: 'pipe' });
    execFileSync('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-m', 'Fixture migration'], { cwd: root, stdio: 'pipe' });
  };
  try {
    instance(root);
    const originalSource = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
    const db = new DatabaseSync(join(root, 'prisma', 'dev.db'));
    try { db.prepare('INSERT INTO Heartbeat (id, source, createdAt) VALUES (?, ?, ?)').run('before-migration', 'Retained history', 0); }
    finally { db.close(); }
    assert.equal(run(root, 'create', destination).status, 0);
    const forward = join(root, 'prisma', 'migrations', '20990101000000_fixture_forward');
    mkdirSync(forward);
    writeFileSync(join(forward, 'migration.sql'), 'ALTER TABLE Heartbeat ADD COLUMN note TEXT NOT NULL DEFAULT \'forward\';\n');
    writeFileSync(join(root, 'prisma', 'schema.prisma'), readFileSync(join(root, 'prisma', 'schema.prisma'), 'utf8').replace('model Heartbeat {', 'model Heartbeat {\n  note String @default("forward")'));
    commit();
    const paths = ['.env', 'config/portal-seed.local.json', 'prisma/dev.db'];
    const before = paths.map(path => readFileSync(join(root, path)));
    const implicit = run(root, 'restore', destination);
    assert.equal(implicit.status, 1);
    assert.deepEqual(paths.map(path => readFileSync(join(root, path))), before);
    const migrated = run(root, 'restore', destination, '--migrate');
    assert.equal(migrated.status, 0, migrated.stderr);
    const migratedDb = new DatabaseSync(join(root, 'prisma', 'dev.db'), { readOnly: true });
    try { assert.deepEqual({ ...migratedDb.prepare('SELECT source, note FROM Heartbeat WHERE id=?').get('before-migration') }, { source: 'Retained history', note: 'forward' }); }
    finally { migratedDb.close(); }
    const broken = join(root, 'prisma', 'migrations', '20990102000000_fixture_failure');
    mkdirSync(broken);
    writeFileSync(join(broken, 'migration.sql'), 'THIS IS DELIBERATELY INVALID SQL;\n');
    commit();
    const working = paths.map(path => readFileSync(join(root, path)));
    const failed = run(root, 'restore', destination, '--migrate');
    assert.equal(failed.status, 1);
    assert.match(failed.stderr, /migration/);
    assert.deepEqual(paths.map(path => readFileSync(join(root, path))), working);
    // Source rollback is an explicit operator action; the CLI restores only matched private state.
    execFileSync('git', ['checkout', originalSource], { cwd: root, stdio: 'pipe' });
    const recovered = run(root, 'restore', destination);
    assert.equal(recovered.status, 0, recovered.stderr);
    const recoveredDb = new DatabaseSync(join(root, 'prisma', 'dev.db'), { readOnly: true });
    try {
      assert.equal(recoveredDb.prepare('SELECT source FROM Heartbeat WHERE id=?').get('before-migration').source, 'Retained history');
      assert.equal(recoveredDb.prepare('PRAGMA table_info(Heartbeat)').all().some(row => row.name === 'note'), false);
    } finally { recoveredDb.close(); }
  } finally {
    for (const path of [root, destination]) {
      assert.equal(dirname(path), dirname(root));
      assert.ok(path.startsWith(join(tmpdir(), 'portal-backup-test-')));
      rmSync(path, { recursive: true, force: true, maxRetries: 3 });
    }
  }
});

test('preflight rejects checkout-contained destinations, effective overrides and incomplete artifacts without publishing secrets', () => {
  const root = mkdtempSync(join(tmpdir(), 'portal-backup-test-'));
  const destination = `${root}-backup`;
  try {
    const { env } = instance(root);
    const inside = run(root, 'create', join(root, '..backup'));
    assert.equal(inside.status, 1);
    assert.match(inside.stderr, /outside/);
    assert.equal(existsSync(join(root, '..backup')), false);
    writeFileSync(join(root, '.env'), env.replace('file:./dev.db', 'file:./other.db'));
    const unsupported = run(root, 'create', destination);
    assert.equal(unsupported.status, 1);
    assert.match(unsupported.stderr, /Unsupported configuration/);
    assert.equal(existsSync(destination), false);
    writeFileSync(join(root, '.env'), env);
    const shell = spawnSync(process.execPath, [cli, 'create', destination], {
      cwd: root, encoding: 'utf8', timeout: 60_000, env: { ...process.env, PORTAL_MODE: 'live' },
    });
    assert.equal(shell.status, 1);
    assert.match(shell.stderr, /Conflicting process/);
    writeFileSync(join(root, '.env'), env.replace('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=', '$EXTERNAL_KEY'));
    const external = spawnSync(process.execPath, [cli, 'create', destination], {
      cwd: root, encoding: 'utf8', timeout: 60_000, env: { ...process.env, EXTERNAL_KEY: Buffer.alloc(32).toString('base64') },
    });
    assert.equal(external.status, 1);
    assert.match(external.stderr, /self-contained/);
    writeFileSync(join(root, '.env'), env);
    writeFileSync(join(root, '.env.local'), 'PORTAL_MODE=live\n');
    const override = run(root, 'create', destination);
    assert.equal(override.status, 1);
    assert.match(override.stderr, /override files/);
    rmSync(join(root, '.env.local'));
    assert.equal(run(root, 'create', destination).status, 0);
    rmSync(join(destination, 'portal-seed.json'));
    const before = readFileSync(join(root, 'prisma', 'dev.db'));
    const incomplete = run(root, 'restore', destination);
    assert.equal(incomplete.status, 1);
    assert.match(incomplete.stderr, /Incomplete backup/);
    assert.deepEqual(readFileSync(join(root, 'prisma', 'dev.db')), before);
  } finally {
    for (const path of [root, destination]) {
      assert.equal(dirname(path), dirname(root));
      assert.ok(path.startsWith(join(tmpdir(), 'portal-backup-test-')));
      rmSync(path, { recursive: true, force: true, maxRetries: 3 });
    }
  }
});
