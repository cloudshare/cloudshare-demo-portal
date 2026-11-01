// Node 24 offline operator CLI. Never import application composition or seed state.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { DatabaseSync, backup } from 'node:sqlite';
import { seedFileSchema } from '../src/config/seed-file-schema.ts';
import { createSecretBox } from '../src/security/secret-box.ts';

const require = createRequire(import.meta.url);
const files = { 'portal.env': '.env', 'portal-seed.json': 'config/portal-seed.local.json', 'database.sqlite': 'prisma/dev.db' };
const overrides = ['.env.local', '.env.production', '.env.production.local', '.env.development', '.env.development.local', '.env.test', '.env.test.local'];
let stage;
let phase = 'validation';
let refusal = '';
let replacing = false;
function fail(message) { refusal = message; throw new Error(); }
function hash(bytes) { return createHash('sha256').update(bytes).digest('hex'); }
function unlinked(path) {
  let current = resolve(path);
  while (true) {
    if (lstatSync(current, { throwIfNoEntry: false })?.isSymbolicLink()) fail('Linked paths are unsupported. No instance files were replaced.');
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
}
function regular(path) { unlinked(path); if (!lstatSync(path).isFile()) fail('Expected a regular instance or artifact file.'); }
function protect(path) {
  if (process.platform !== 'win32') { chmodSync(path, lstatSync(path).isDirectory() ? 0o700 : 0o600); return; }
  const command = `
    $ErrorActionPreference = 'Stop'
    $path = $env:PORTAL_BACKUP_PRIVATE_PATH
    $directory = [System.IO.Directory]::Exists($path)
    $acl = if ($directory) { New-Object System.Security.AccessControl.DirectorySecurity } else { New-Object System.Security.AccessControl.FileSecurity }
    $acl.SetAccessRuleProtection($true, $false)
    $inheritance = if ($directory) { [System.Security.AccessControl.InheritanceFlags]'ContainerInherit, ObjectInherit' } else { [System.Security.AccessControl.InheritanceFlags]::None }
    foreach ($sid in @([System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value, 'S-1-5-18', 'S-1-5-32-544')) {
      $acl.AddAccessRule([System.Security.AccessControl.FileSystemAccessRule]::new([System.Security.Principal.SecurityIdentifier]::new($sid), 'FullControl', $inheritance, 'None', 'Allow'))
    }
    if ($directory) { [System.IO.Directory]::SetAccessControl($path, $acl) } else { [System.IO.File]::SetAccessControl($path, $acl) }
  `;
  execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(command, 'utf16le').toString('base64')], {
    env: { ...process.env, PORTAL_BACKUP_PRIVATE_PATH: path }, stdio: 'pipe', windowsHide: true, timeout: 10_000,
  });
}
function environment(contents) {
  // Next expands variables; node:util.parseEnv alone is not the runtime contract.
  const parse = inherited => JSON.parse(execFileSync(process.execPath, ['-e',
    "const input=JSON.parse(require('node:fs').readFileSync(0,'utf8'));process.env=input.inherited;const {processEnv}=require(process.argv[1]);const [combined]=processEnv([{path:'.env',contents:input.contents,env:{}}],undefined,{info(){},error(){throw Error()}},true);process.stdout.write(JSON.stringify(combined));",
    require.resolve('@next/env'),
  ], { input: JSON.stringify({ contents, inherited }), encoding: 'utf8', stdio: 'pipe', timeout: 10_000 }));
  const relevant = key => /^(PORTAL_|CLOUDSHARE_|HELIOS_|CERTALIS_)/.test(key) || ['DATABASE_URL', 'ADMIN_TOKEN', 'HEARTBEAT_TIMEOUT_MS'].includes(key);
  const ordinary = Object.fromEntries(Object.entries(process.env).filter(([key]) => !relevant(key)));
  const stored = parse(ordinary);
  const effective = parse(process.env);
  if (Object.keys(effective).some(key => relevant(key) && effective[key] !== stored[key])) fail('Conflicting process configuration: clear portal environment overrides and retry.');
  const selfContained = parse({});
  if (Object.keys(stored).some(key => relevant(key) && stored[key] !== selfContained[key])) fail('Configuration must be self-contained in .env; external variable expansion is unsupported.');
  if (stored.DATABASE_URL !== 'file:./dev.db' || stored.PORTAL_SEED_SOURCE !== 'file' ||
      !['./config/portal-seed.local.json', 'config/portal-seed.local.json'].includes(stored.PORTAL_SEED_CONFIG_PATH)) {
    fail('Unsupported configuration: require canonical file-mode .env, seed JSON and SQLite paths.');
  }
  if (!['fixture', 'live'].includes(stored.PORTAL_MODE)) fail('Invalid portal runtime mode.');
  if (Buffer.from(stored.PORTAL_MASTER_KEY ?? '', 'base64').length !== 32) fail('Invalid portal master key.');
  return stored;
}
function source(root) {
  if (execFileSync('git', ['status', '--porcelain', '--untracked-files=no'], { cwd: root, encoding: 'utf8', stdio: 'pipe' }).trim()) fail('Tracked source changes must be committed before backing up or restoring.');
  const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', stdio: 'pipe' }).trim();
  const directory = join(root, 'prisma', 'migrations');
  const migrations = readdirSync(directory, { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => {
    const path = join(directory, entry.name, 'migration.sql'); regular(path);
    return { name: entry.name, checksum: hash(readFileSync(path)) };
  }).sort((a, b) => a.name.localeCompare(b.name, 'en'));
  return { sha, version: JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version,
    schemaHash: hash(readFileSync(join(root, 'prisma', 'schema.prisma'))), migrations };
}
function checkDatabase(path, env, migrations) {
  const db = new DatabaseSync(path, { readOnly: true, timeout: 3000 });
  try {
    if (db.prepare('PRAGMA integrity_check').all().some(row => row.integrity_check !== 'ok')) fail('SQLite integrity check failed.');
    const history = db.prepare('SELECT migration_name, checksum, finished_at, rolled_back_at FROM _prisma_migrations ORDER BY migration_name').all();
    if (history.some(row => !row.finished_at && !row.rolled_back_at)) fail('Unfinished or failed database migration requires operator recovery.');
    const applied = history.filter(row => row.finished_at && !row.rolled_back_at).map(row => ({ name: row.migration_name, checksum: row.checksum }));
    if (JSON.stringify(applied) !== JSON.stringify(migrations)) fail('Database migration history does not match source metadata.');
    const secrets = createSecretBox(Buffer.from(env.PORTAL_MASTER_KEY, 'base64'));
    for (const row of db.prepare('SELECT apiIdCiphertext, apiKeyCiphertext, webhookSecretCiphertext FROM CloudShareConnection').iterate()) {
      for (const value of Object.values(row)) secrets.decrypt(value);
    }
  } finally { db.close(); }
}
function standalone(path) {
  const db = new DatabaseSync(path, { timeout: 3000 });
  try { db.exec('PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode=DELETE'); }
  finally { db.close(); }
}
function verify(directory) {
  if (![...Object.keys(files), 'manifest.json'].every(name => existsSync(join(directory, name)))) fail('Incomplete backup: require all three payload files and manifest.json. No instance files were replaced.');
  for (const name of [...Object.keys(files), 'manifest.json']) regular(join(directory, name));
  const manifest = JSON.parse(readFileSync(join(directory, 'manifest.json'), 'utf8'));
  if (manifest.formatVersion !== 1 || manifest.platform !== process.platform || !/^[a-f0-9]{40}$/.test(manifest.source?.sha ?? '') || !Array.isArray(manifest.source?.migrations)) fail('Unsupported artifact format, OS or source metadata.');
  for (const name of Object.keys(files)) {
    const bytes = readFileSync(join(directory, name));
    if (manifest.files?.[name]?.size !== bytes.length || manifest.files?.[name]?.sha256 !== hash(bytes)) fail('Backup integrity mismatch: do not restore this artifact.');
  }
  const env = environment(readFileSync(join(directory, 'portal.env'), 'utf8'));
  seedFileSchema.parse(JSON.parse(readFileSync(join(directory, 'portal-seed.json'), 'utf8')));
  checkDatabase(join(directory, 'database.sqlite'), env, manifest.source.migrations);
  return manifest;
}
function restore(directory, root, migrate) {
  const manifest = verify(directory);
  if (overrides.some(path => existsSync(join(root, path)))) fail('Environment override files are unsupported. Resolve them before restore.');
  for (const path of Object.values(files)) { unlinked(join(root, path)); if (existsSync(join(root, path))) regular(join(root, path)); }
  if (['-wal', '-shm', '-journal'].some(suffix => existsSync(join(root, 'prisma', 'dev.db') + suffix))) fail('Target SQLite sidecar files exist. Keep services stopped and resolve database state before restore.');
  if (existsSync(join(root, '.env'))) environment(readFileSync(join(root, '.env'), 'utf8'));
  const target = source(root);
  const historical = manifest.source.migrations;
  const prefixMatches = JSON.stringify(target.migrations.slice(0, historical.length)) === JSON.stringify(historical);
  const pending = target.migrations.length > historical.length;
  if (!prefixMatches || target.migrations.length < historical.length || (!pending && target.schemaHash !== manifest.source.schemaHash)) fail('Incompatible target schema or migration history. No instance files were replaced.');
  if (pending && !migrate) fail('Pending compatible migrations require explicit --migrate. No instance files were replaced.');
  stage = mkdtempSync(join(root, '.restore-instance-'));
  protect(stage);
  phase = 'restore staging';
  for (const name of Object.keys(files)) {
    writeFileSync(join(stage, name), readFileSync(join(directory, name)), { mode: 0o600 }); protect(join(stage, name));
  }
  const env = environment(readFileSync(join(stage, 'portal.env'), 'utf8'));
  if (pending) {
    phase = 'migration';
    const databaseUrl = `file:${join(stage, 'database.sqlite').replaceAll('\\', '/')}`;
    execFileSync(process.execPath, [require.resolve('prisma/build/index.js'), 'migrate', 'deploy', '--schema', join(root, 'prisma', 'schema.prisma')], {
      cwd: root, env: { ...process.env, DATABASE_URL: databaseUrl }, stdio: 'pipe', timeout: 60_000,
    });
  }
  standalone(join(stage, 'database.sqlite'));
  checkDatabase(join(stage, 'database.sqlite'), env, target.migrations);
  mkdirSync(join(root, 'config'), { recursive: true });
  mkdirSync(join(root, 'prisma'), { recursive: true });
  replacing = true;
  // Three explicit replacements are not atomic. The operator retains the original off-VM artifact.
  for (const [name, path] of Object.entries(files)) renameSync(join(stage, name), join(root, path));
  process.stdout.write('Instance restored with its original key and seed configuration. Start only the matching prepared source/build.\n');
}
try {
  if (Number(process.versions.node.split('.')[0]) < 24) fail('Node 24 or newer is required.');
  const [command, argument, ...extra] = process.argv.slice(2);
  if (command === '--help') {
    process.stdout.write('Usage: node scripts/instance-backup.mjs create|verify|restore <private-directory> [--migrate]\n--migrate is restore-only and applies compatible migrations to staged data.\nStop services before create or restore. Keep and verify a copy OFF the VM.\n');
  } else {
    if (!['create', 'verify', 'restore'].includes(command) || !argument || (extra.length && !(command === 'restore' && extra.length === 1 && extra[0] === '--migrate'))) fail('Usage: create|verify|restore <private-directory> [--migrate]');
    const root = process.cwd();
    const directory = resolve(argument);
    if (command === 'verify') {
      verify(directory);
      process.stdout.write('Backup verified. Keep it private; verification does not prove an off-VM copy exists.\n');
    } else if (command === 'restore') {
      restore(directory, root, extra[0] === '--migrate');
    } else {
      if (!Object.values(files).every(path => existsSync(join(root, path)))) fail('Incomplete instance: require .env, config/portal-seed.local.json and prisma/dev.db. No files were replaced.');
      if (overrides.some(path => existsSync(join(root, path)))) fail('Environment override files are unsupported. Resolve them before backup.');
      for (const path of Object.values(files)) regular(join(root, path));
      const location = relative(root, directory);
      if (!isAbsolute(location) && location !== '..' && !location.startsWith(`..${sep}`)) fail('Backup destination must be outside the installation checkout and public web roots.');
      if (existsSync(directory)) fail('Backup destination already exists. Choose a new private directory.');
      unlinked(directory);
      regular(join(root, 'package.json'));
      const envBytes = readFileSync(join(root, '.env'));
      const env = environment(envBytes.toString('utf8'));
      const seed = readFileSync(join(root, 'config', 'portal-seed.local.json'));
      seedFileSchema.parse(JSON.parse(seed));
      const metadata = source(root);
      stage = mkdtempSync(join(dirname(directory), '.portal-backup-'));
      protect(stage);
      phase = 'SQLite backup';
      const db = new DatabaseSync(join(root, 'prisma', 'dev.db'), { readOnly: true, timeout: 3000 });
      try { await backup(db, join(stage, 'database.sqlite')); } finally { db.close(); }
      standalone(join(stage, 'database.sqlite'));
      checkDatabase(join(stage, 'database.sqlite'), env, metadata.migrations);
      writeFileSync(join(stage, 'portal.env'), envBytes, { mode: 0o600 });
      writeFileSync(join(stage, 'portal-seed.json'), seed, { mode: 0o600 });
      const entries = {};
      for (const name of Object.keys(files)) { protect(join(stage, name)); const bytes = readFileSync(join(stage, name)); entries[name] = { size: bytes.length, sha256: hash(bytes) }; }
      writeFileSync(join(stage, 'manifest.json'), JSON.stringify({ formatVersion: 1, createdAt: new Date().toISOString(), platform: process.platform, source: metadata, files: entries }, null, 2) + '\n', { mode: 0o600 });
      verify(stage);
      renameSync(stage, directory); stage = undefined;
      process.stdout.write('Private backup created and verified. Copy OFF the VM and verify the received copy before rebuilding.\n');
    }
  }
} catch {
  process.stderr.write(`${replacing ? 'Restore interrupted during file replacement. KEEP SERVICES STOPPED. Restore the original verified artifact with its matching source/build before starting.' : refusal || `Instance backup failed during ${phase}; no instance files were replaced. Check private configuration, database/key pairing and permissions.`}\n`);
  process.exitCode = 1;
} finally {
  // stage is exclusively allocated by mkdtemp; never remove a caller-supplied destination.
  if (stage) {
    try { rmSync(stage, { recursive: true, force: true, maxRetries: 3 }); }
    catch { process.stderr.write('Private staging remains. Remove the allocated backup/restore staging directory before delivery.\n'); process.exitCode = 1; }
  }
}
