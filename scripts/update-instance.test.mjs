import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { hashPassword, verifyPassword } from '../src/auth/password.ts';
import { createSecretBox } from '../src/security/secret-box.ts';

const cli = fileURLToPath(new URL('./update-instance.mjs', import.meta.url));
const repo = dirname(dirname(cli));
const require = createRequire(import.meta.url);
const git = (root, ...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: 'pipe' }).trim();

test('an artifact hash mismatch refuses the update before changing source or private files', () => {
  const root = mkdtempSync(join(tmpdir(), 'portal-update-test-'));
  try {
    git(root, 'init');
    writeFileSync(join(root, '.gitignore'), '.env\n');
    writeFileSync(join(root, 'release.txt'), 'original release\n');
    git(root, 'add', '.');
    git(root, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-m', 'Original');
    const base = git(root, 'rev-parse', 'HEAD');
    writeFileSync(join(root, '.env'), 'fixture-private-value\n');
    const bundle = join(root, 'incoming.bundle');
    git(root, 'bundle', 'create', bundle, 'HEAD');
    const result = spawnSync(process.execPath, [cli, 'apply', bundle, '0'.repeat(64), base, base,
      join(root, 'unused-backup'), '--app-stopped'], { cwd: root, encoding: 'utf8', timeout: 30_000 });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /bundle SHA256 mismatch/i);
    assert.doesNotMatch(result.stdout + result.stderr, /fixture-private-value/);
    assert.equal(git(root, 'rev-parse', 'HEAD'), base);
    assert.equal(readFileSync(join(root, '.env'), 'utf8'), 'fixture-private-value\n');
    assert.equal(readFileSync(join(root, 'release.txt'), 'utf8'), 'original release\n');
    assert.equal(existsSync(join(root, 'node_modules')), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('pinned updates preserve matched state and a failed next build supports explicit original-source recovery', async () => {
  const allocated = mkdtempSync(join(tmpdir(), 'portal-update-test-'));
  const root = join(allocated, 'installation');
  const artifact = join(allocated, 'backup');
  const backupCli = join(repo, 'scripts', 'instance-backup.mjs');
  const invoke = (script, args) => spawnSync(process.execPath, [script, ...args], {
    cwd: root, encoding: 'utf8', timeout: 120_000,
  });
  try {
    mkdirSync(join(root, 'config'), { recursive: true });
    cpSync(join(repo, 'prisma'), join(root, 'prisma'), { recursive: true,
      filter: path => !/\.db(?:-|$)/.test(path) });
    writeFileSync(join(root, '.gitignore'), '.env\nconfig/*.local.json\nprisma/*.db*\nnode_modules/\n.next/\nruntime/\n');
    writeFileSync(join(root, '.env.example'), 'PORTAL_MODE=fixture\n');
    writeFileSync(join(root, '.env.e2e.example'), 'PORTAL_MODE=fixture\n');
    const pkg = { name: 'portal-update-fixture', version: '1.0.0', scripts: {
      'prisma:generate': 'node -e "process.exit(0)"', build: 'node build.cjs',
    } };
    writeFileSync(join(root, 'package.json'), JSON.stringify(pkg));
    writeFileSync(join(root, 'package-lock.json'), JSON.stringify({ name: pkg.name, version: pkg.version,
      lockfileVersion: 3, requires: true, packages: { '': { name: pkg.name, version: pkg.version } } }));
    writeFileSync(join(root, 'build.cjs'), "require('node:fs').mkdirSync('.next',{recursive:true});require('node:fs').writeFileSync('.next/release','original');\n");
    const env = 'DATABASE_URL=file:./dev.db\nPORTAL_MASTER_KEY=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=\nPORTAL_MODE=fixture\nPORTAL_SEED_SOURCE=file\nPORTAL_SEED_CONFIG_PATH=./config/portal-seed.local.json\n';
    const seed = JSON.stringify({ heliosAdminEmail: 'admin@example.invalid', heliosAdminPassword: 'fixture-password',
      certalisSalesAdminEmail: 'sales@example.invalid', certalisSalesAdminPassword: 'fixture-sales-password',
      heliosInstructor: { id: 'fixture', name: 'Fixture Instructor' }, heliosCloudShareConnection: null });
    writeFileSync(join(root, '.env'), env);
    writeFileSync(join(root, 'config', 'portal-seed.local.json'), seed);
    mkdirSync(join(root, 'runtime'));
    writeFileSync(join(root, 'runtime', 'native-config'), 'unchanged native configuration');
    execFileSync(process.execPath, [require.resolve('prisma/build/index.js'), 'migrate', 'deploy', '--schema', join(root, 'prisma', 'schema.prisma')], {
      cwd: root, env: { ...process.env, DATABASE_URL: `file:${join(root, 'prisma', 'dev.db').replaceAll('\\', '/')}` }, stdio: 'pipe', timeout: 60_000,
    });
    const secrets = createSecretBox(Buffer.alloc(32));
    const password = await hashPassword('preserved-password');
    const db = new DatabaseSync(join(root, 'prisma', 'dev.db'));
    try {
      db.prepare('INSERT INTO Customer (id, slug, name) VALUES (?, ?, ?)').run('customer', 'retained', 'Retained Customer');
      db.prepare('INSERT INTO User (id, customerId, email, passwordHash, role) VALUES (?, ?, ?, ?, ?)').run('user', 'customer', 'retained@example.invalid', password, 'admin');
      db.prepare('INSERT INTO CloudShareConnection (id, customerId, apiIdCiphertext, apiKeyCiphertext, webhookSecretCiphertext, webhookPathToken, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run('connection', 'customer', secrets.encrypt('saved-api-id'), secrets.encrypt('saved-api-key'), secrets.encrypt('saved-webhook-secret'), 'saved-path', 0);
    } finally { db.close(); }
    git(root, 'init'); git(root, 'add', '.');
    const commit = message => git(root, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-am', message);
    commit('Original source');
    const base = git(root, 'rev-parse', 'HEAD');
    writeFileSync(join(root, 'build.cjs'), "require('node:fs').mkdirSync('.next',{recursive:true});require('node:fs').writeFileSync('.next/release','updated');\n");
    commit('Approved release');
    const target = git(root, 'rev-parse', 'HEAD');
    const bundle = join(allocated, 'release.bundle');
    git(root, 'bundle', 'create', bundle, 'HEAD');
    git(root, 'checkout', '--detach', base);
    const hash = createHash('sha256').update(readFileSync(bundle)).digest('hex');
    const preflight = invoke(cli, ['preflight', bundle, hash, base, target]);
    assert.equal(preflight.status, 0, preflight.stderr);
    assert.equal(existsSync(artifact), false, 'preflight does not require or create a backup');
    assert.equal(git(root, 'rev-parse', 'HEAD'), base);
    const saved = invoke(backupCli, ['create', artifact]);
    assert.equal(saved.status, 0, saved.stderr);
    const updated = invoke(cli, ['apply', bundle, hash, base, target, artifact, '--app-stopped']);
    assert.equal(updated.status, 0, updated.stderr);
    assert.match(updated.stdout, new RegExp(target));
    assert.equal(git(root, 'rev-parse', 'HEAD'), target);
    assert.equal(readFileSync(join(root, '.next', 'release'), 'utf8'), 'updated');
    assert.equal(readFileSync(join(root, '.env'), 'utf8'), env);
    assert.equal(readFileSync(join(root, 'config', 'portal-seed.local.json'), 'utf8'), seed);
    assert.equal(readFileSync(join(root, 'runtime', 'native-config'), 'utf8'), 'unchanged native configuration');
    const current = new DatabaseSync(join(root, 'prisma', 'dev.db'), { readOnly: true });
    try {
      assert.equal(await verifyPassword('preserved-password', current.prepare('SELECT passwordHash FROM User WHERE id=?').get('user').passwordHash), true);
      assert.equal(secrets.decrypt(current.prepare('SELECT apiKeyCiphertext FROM CloudShareConnection WHERE id=?').get('connection').apiKeyCiphertext), 'saved-api-key');
    } finally { current.close(); }
    assert.doesNotMatch(updated.stdout + updated.stderr, /saved-api-key|preserved-password|fixture-password/);
    const recovery = join(allocated, 'recovery');
    const recoverySaved = invoke(backupCli, ['create', recovery]);
    assert.equal(recoverySaved.status, 0, recoverySaved.stderr);
    writeFileSync(join(root, 'build.cjs'), "process.stderr.write('fixture-password must stay private');process.exit(7);\n");
    commit('Deliberately failed build');
    const broken = git(root, 'rev-parse', 'HEAD');
    const brokenBundle = join(allocated, 'broken.bundle');
    git(root, 'bundle', 'create', brokenBundle, 'HEAD');
    git(root, 'checkout', '--detach', target);
    const brokenHash = createHash('sha256').update(readFileSync(brokenBundle)).digest('hex');
    const failed = invoke(cli, ['apply', brokenBundle, brokenHash, target, broken, recovery, '--app-stopped']);
    assert.equal(failed.status, 1);
    assert.match(failed.stderr, /production build/);
    assert.match(failed.stderr, /KEEP THE APPLICATION STOPPED/);
    assert.match(failed.stderr, new RegExp(target), 'failure identifies the exact source paired with the recovery artifact');
    assert.doesNotMatch(failed.stdout + failed.stderr, /fixture-password|saved-api-key|preserved-password/);
    assert.equal(git(root, 'rev-parse', 'HEAD'), broken);
    // The operator follows this sequence; update never starts a service or rolls back automatically.
    git(root, 'checkout', '--detach', target);
    const npm = args => execFileSync(process.platform === 'win32' ? 'cmd.exe' : 'npm',
      process.platform === 'win32' ? ['/d', '/s', '/c', `npm.cmd ${args.join(' ')}`] : args,
      { cwd: root, stdio: 'pipe', windowsHide: true, timeout: 120_000 });
    npm(['ci']);
    npm(['run', 'prisma:generate']);
    const restored = invoke(backupCli, ['restore', recovery]);
    assert.equal(restored.status, 0, restored.stderr);
    npm(['run', 'build']);
    assert.equal(git(root, 'rev-parse', 'HEAD'), target);
    assert.equal(readFileSync(join(root, '.next', 'release'), 'utf8'), 'updated');
    assert.equal(readFileSync(join(root, '.env'), 'utf8'), env);
    assert.equal(readFileSync(join(root, 'config', 'portal-seed.local.json'), 'utf8'), seed);
    const recovered = new DatabaseSync(join(root, 'prisma', 'dev.db'), { readOnly: true });
    try {
      assert.equal(await verifyPassword('preserved-password', recovered.prepare('SELECT passwordHash FROM User WHERE id=?').get('user').passwordHash), true);
      assert.equal(secrets.decrypt(recovered.prepare('SELECT apiKeyCiphertext FROM CloudShareConnection WHERE id=?').get('connection').apiKeyCiphertext), 'saved-api-key');
    } finally { recovered.close(); }
  } finally {
    rmSync(allocated, { recursive: true, force: true, maxRetries: 3 });
  }
});

test('preflight refuses a wrong base, dirty tracked source and a divergent release without changing the checkout', () => {
  const root = mkdtempSync(join(tmpdir(), 'portal-update-test-'));
  try {
    git(root, 'init');
    writeFileSync(join(root, 'release.txt'), 'original release\n');
    git(root, 'add', '.');
    const commit = message => git(root, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-am', message);
    commit('Original');
    const base = git(root, 'rev-parse', 'HEAD');
    writeFileSync(join(root, 'release.txt'), 'target release\n');
    commit('Target');
    const target = git(root, 'rev-parse', 'HEAD');
    const bundle = join(root, 'incoming.bundle');
    git(root, 'bundle', 'create', bundle, 'HEAD');
    const hash = createHash('sha256').update(readFileSync(bundle)).digest('hex');
    git(root, 'checkout', '--detach', base);
    const refuses = (expectedBase, message) => {
      const beforeHead = git(root, 'rev-parse', 'HEAD');
      const beforeSource = readFileSync(join(root, 'release.txt'), 'utf8');
      const result = spawnSync(process.execPath, [cli, 'preflight', bundle, hash, expectedBase, target,
        join(root, 'unused-backup')], { cwd: root, encoding: 'utf8', timeout: 30_000 });
      assert.equal(result.status, 1);
      assert.match(result.stderr, message);
      assert.equal(git(root, 'rev-parse', 'HEAD'), beforeHead);
      assert.equal(readFileSync(join(root, 'release.txt'), 'utf8'), beforeSource);
    };
    refuses('0'.repeat(40), /expected base/i);
    writeFileSync(join(root, 'release.txt'), 'operator change\n');
    refuses(base, /tracked source changes/i);
    commit('Divergent local release');
    refuses(git(root, 'rev-parse', 'HEAD'), /not a fast-forward/i);
    git(root, 'checkout', '--detach', target);
    writeFileSync(join(root, '.env.local'), 'PRIVATE=fixture-secret\n');
    git(root, 'add', '.env.local');
    commit('Unsupported private configuration');
    const privateTarget = git(root, 'rev-parse', 'HEAD');
    const privateBundle = join(root, 'private.bundle');
    git(root, 'bundle', 'create', privateBundle, 'HEAD');
    git(root, 'checkout', '--detach', target);
    const privateHash = createHash('sha256').update(readFileSync(privateBundle)).digest('hex');
    const sourceBeforeRefusal = readFileSync(join(root, 'release.txt'));
    const refused = spawnSync(process.execPath, [cli, 'preflight', privateBundle, privateHash, target, privateTarget],
      { cwd: root, encoding: 'utf8', timeout: 30_000 });
    assert.equal(refused.status, 1);
    assert.match(refused.stderr, /tracks private instance/);
    assert.equal(git(root, 'rev-parse', 'HEAD'), target);
    assert.equal(existsSync(join(root, '.env.local')), false);
    assert.deepEqual(readFileSync(join(root, 'release.txt')), sourceBeforeRefusal);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
