// Downloaded maintenance workflow; permanent launchers only acquire this release.
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdtempSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
const tools = dirname(dirname(fileURLToPath(import.meta.url)));
let refusal, recovery, base;
let phase = 'prerequisites';
let stopped = false;
const run = (cwd, command, args, timeout = 120000) => execFileSync(command, args, { cwd, stdio: 'pipe', encoding: 'utf8', windowsHide: true, timeout, maxBuffer: 10 * 1024 * 1024 });
const git = (cwd, ...args) => run(cwd, 'git', args).trim();
function cli(root, script, args) {
  try {
    return run(root, process.execPath, ['--disable-warning=ExperimentalWarning', '--disable-warning=MODULE_TYPELESS_PACKAGE_JSON', join(tools, 'scripts', script), ...args], 900000);
  } catch (error) {
    // These first-party CLIs deliberately catch failures and emit safe refusals.
    // Never forward npm, Git, provider, or native-service subprocess output.
    if (error.status === 1 && error.stderr?.trim()) refusal = error.stderr.trim();
    throw error;
  }
}
const npm = (root, command) => run(root, process.platform === 'win32' ? 'cmd.exe' : 'npm', process.platform === 'win32' ? ['/d', '/s', '/c', `npm.cmd ${command}`] : command.split(' '), 900000);
const refuse = message => { refusal = message; throw Error(); };
function native(root, action) {
  if (process.platform === 'win32') run(root, 'powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', join(tools, 'scripts/instance-service.ps1'), '-Action', action, '-Installation', root]);
  else run(root, '/bin/bash', [join(tools, 'scripts/instance-service.sh'), action, root]);
}
try {
  const [argument, ...extra] = process.argv.slice(2);
  if (Number(process.versions.node.split('.')[0]) < 24 || !argument || extra.length) refuse('Usage: Node 24 scripts/maintain-instance.mjs <installation>');
  const root = resolve(argument);
  const present = ['.env', 'config/portal-seed.local.json', 'prisma/dev.db'].filter(path => existsSync(join(root, path)));
  if (present.length && present.length !== 3) refuse('Partial instance state: resolve the private files with the owner; never reset automatically.');
  if (git(root, 'status', '--porcelain', '--untracked-files=no')) refuse('Tracked source edits must be resolved before maintenance.');
  const location = relative(realpathSync(root), realpathSync(tools));
  if (!isAbsolute(location) && location !== '..' && !location.startsWith(`..${sep}`)) refuse('Retain downloaded tooling outside the installation.');
  for (const path of [root, ...['config', 'prisma', ...present].map(path => join(root, path))]) {
    if (lstatSync(path, { throwIfNoEntry: false })?.isSymbolicLink()) refuse('Linked instance paths require operator resolution.');
  }
  if (['.env.local', '.env.production', '.env.production.local', '.env.development', '.env.development.local', '.env.test', '.env.test.local'].some(path => existsSync(join(root, path)))) refuse('Environment override files require operator resolution.');
  base = git(root, 'rev-parse', 'HEAD');
  const target = git(tools, 'rev-parse', 'HEAD');
  if (git(tools, 'status', '--porcelain', '--untracked-files=no')) refuse('Downloaded tooling has tracked edits. Obtain a clean release.');
  process.stdout.write(`Preparing release ${target}; installed source ${base}.\n`);
  recovery = mkdtempSync(join(dirname(tools), '.portal-recovery-'));
  const bundle = join(recovery, 'release.bundle');
  git(tools, 'bundle', 'create', bundle, 'HEAD');
  const hash = createHash('sha256').update(readFileSync(bundle)).digest('hex');
  phase = 'source preflight'; cli(root, 'update-instance.mjs', ['preflight', bundle, hash, base, target]);
  phase = 'retained tooling dependencies'; npm(tools, 'ci'); npm(tools, 'run prisma:generate');
  phase = 'stopping the existing app';
  // Even a failed stop may have disabled/stopped the task. Never promise it is running.
  stopped = true; native(root, 'stop');
  if (present.length) {
    const backup = join(recovery, 'instance-backup');
    phase = 'verified private backup'; cli(root, 'instance-backup.mjs', ['create', backup]); cli(root, 'instance-backup.mjs', ['verify', backup]);
    phase = 'state-preserving update'; cli(root, 'update-instance.mjs', ['apply', bundle, hash, base, target, backup, '--app-stopped']);
  } else {
    phase = 'source advance'; git(root, 'merge', '--ff-only', target);
    phase = 'locked dependency installation'; npm(root, 'ci');
    phase = 'Prisma client generation'; npm(root, 'run prisma:generate');
    phase = 'private instance initialization'; cli(root, 'setup-instance.mjs', []);
    phase = 'production build'; npm(root, 'run build');
  }
  phase = 'documentation build'; npm(root, 'run build:docs');
  phase = 'documentation publication'; native(root, 'docs');
  phase = 'starting the existing app'; native(root, 'start'); stopped = false;
  process.stdout.write(`Portal start requested at release ${target}. Verify HTTPS sign-in and preserved state.\nRetained recovery directory: ${recovery}\nRetained tooling: ${tools}\n`);
} catch {
  process.stderr.write(`${refusal ?? `Maintenance failed during ${phase}. Inspect the retained release and private configuration.`}\n`);
  if (stopped) process.stderr.write(`KEEP THE APPLICATION STOPPED until recovery is complete. Retain tooling ${tools} and recovery ${recovery}. Original source: ${base}. Follow docs/implementation/instance-updates.md for matched source/backup recovery. Never reset; a fresh build failure after setup is an initialized instance on the next run.\n`);
  process.exitCode = 1;
}
