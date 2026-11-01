// Offline operator workflow. Application stop/start remains operator-owned.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

let refusal;
let phase = 'validation';
let advanced = false;
let recoverySource;
const fail = message => { refusal = message; throw new Error(); };
const git = (...args) => execFileSync('git', args, { encoding: 'utf8', stdio: 'pipe', windowsHide: true }).trim();
const backupCli = fileURLToPath(new URL('./instance-backup.mjs', import.meta.url));
const backup = (...args) => execFileSync(process.execPath, [backupCli, ...args], { stdio: 'pipe', windowsHide: true, timeout: 120_000 });
function npm(command) {
  // Only these fixed commands reach the Windows command interpreter.
  const commands = { install: ['ci'], generate: ['run', 'prisma:generate'], build: ['run', 'build'] };
  const args = commands[command];
  execFileSync(process.platform === 'win32' ? 'cmd.exe' : 'npm', process.platform === 'win32'
    ? ['/d', '/s', '/c', `npm.cmd ${args.join(' ')}`] : args,
  { stdio: 'pipe', windowsHide: true, timeout: 600_000, maxBuffer: 10 * 1024 * 1024 });
}

try {
  const [command, bundle, expectedHash, base, target, artifact, ...extra] = process.argv.slice(2);
  if (Number(process.versions.node.split('.')[0]) < 24) fail('Node 24 or newer is required.');
  if (!['preflight', 'apply'].includes(command) || !bundle || !/^[a-f0-9]{64}$/.test(expectedHash ?? '')) {
    fail('Usage: preflight <bundle> <sha256> <base-sha> <target-sha>; apply adds <backup-directory> --app-stopped.');
  }
  const actualHash = createHash('sha256').update(readFileSync(bundle)).digest('hex');
  if (actualHash !== expectedHash) fail('Bundle SHA256 mismatch. No source or instance files were changed.');
  if (!/^[a-f0-9]{40}$/.test(base ?? '') || !/^[a-f0-9]{40}$/.test(target ?? '')) fail('Expected base and target must be full commit SHAs.');
  if (git('rev-parse', 'HEAD') !== base) fail('Checkout does not match the expected base. No source or instance files were changed.');
  if (git('status', '--porcelain', '--untracked-files=no')) fail('Tracked source changes must be resolved before update. No source or instance files were changed.');
  git('bundle', 'verify', bundle);
  const advertised = git('bundle', 'list-heads', bundle).split('\n').map(line => line.trim().split(/\s+/));
  const reference = advertised.find(([sha]) => sha === target)?.[1];
  if (!reference) fail('Pinned target is not advertised by the verified bundle.');
  // Import only objects/FETCH_HEAD; preflight never advances the checkout.
  git('fetch', '--no-tags', '--', bundle, reference);
  if (git('rev-parse', 'FETCH_HEAD^{commit}') !== target) fail('Imported bundle target does not match the pinned commit.');
  if (git('merge-base', base, target) !== base) fail('Pinned target is not a fast-forward of the installed source. No source or instance files were changed.');
  const paths = git('ls-tree', '-r', '--name-only', target).split('\n');
  if (paths.some(path => !['.env.example', '.env.e2e.example'].includes(path) &&
    /^(?:\.env(?:$|\.)|config\/portal-seed\.local\.json$|prisma\/dev\.db(?:$|-)|runtime(?:\/|$)|node_modules(?:\/|$)|\.next(?:\/|$))/.test(path))) {
    fail('Target source tracks private instance or native runtime paths. No source or instance files were changed.');
  }
  if (command === 'preflight') {
    process.stdout.write(`Preflight passed: ${base} -> ${target}. Stop the owned application and create a verified matched backup before apply.\n`);
  } else {
    if (!artifact || extra.length !== 1 || extra[0] !== '--app-stopped') fail('Apply requires a verified backup directory and explicit --app-stopped confirmation.');
    const toolsLocation = relative(process.cwd(), dirname(dirname(backupCli)));
    if (!isAbsolute(toolsLocation) && toolsLocation !== '..' && !toolsLocation.startsWith(`..${sep}`)) {
      fail('Run the approved retained tooling checkout outside the installation so recovery tools survive source rollback.');
    }
    phase = 'backup verification';
    backup('verify', artifact);
    const manifest = JSON.parse(readFileSync(join(artifact, 'manifest.json'), 'utf8'));
    if (manifest.source.sha !== base) fail('Backup source does not match the expected base. No source or instance files were changed.');
    recoverySource = base;
    for (const [saved, current] of [['portal.env', '.env'], ['portal-seed.json', 'config/portal-seed.local.json']]) {
      if (!readFileSync(join(artifact, saved)).equals(readFileSync(current))) fail('Backup configuration does not match the current instance. No source or instance files were changed.');
    }
    phase = 'source advance';
    advanced = true;
    git('merge', '--ff-only', target);
    if (git('rev-parse', 'HEAD') !== target) fail('Source advance did not reach the pinned target.');
    phase = 'locked dependency installation'; npm('install');
    phase = 'Prisma client generation'; npm('generate');
    phase = 'staged instance migration'; backup('restore', artifact, '--migrate');
    phase = 'production build'; npm('build');
    process.stdout.write(`Release prepared at ${target}. Start the existing application and verify public HTTPS authentication and preserved state.\n`);
  }
} catch {
  process.stderr.write(`${refusal ?? `Update failed during ${phase}. Inspect the approved source, dependencies and private instance configuration.`}\n`);
  if (advanced) process.stderr.write(`KEEP THE APPLICATION STOPPED. Recover source ${recoverySource}, install its locked dependencies, generate its client, restore the original verified artifact with retained backup tooling, then build before starting. Git rollback does not undo database migrations.\n`);
  process.exitCode = 1;
}
