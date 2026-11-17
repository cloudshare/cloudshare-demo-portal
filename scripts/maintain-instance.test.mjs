import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
const repo = dirname(dirname(fileURLToPath(import.meta.url)));
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: 'pipe' }).trim();
for (const state of ['partial', 'dirty']) test(`maintenance refuses ${state} installation before changing it`, () => {
  const root = mkdtempSync(join(tmpdir(), 'portal-maintenance-test-'));
  try {
    writeFileSync(join(root, 'source.txt'), 'original'); writeFileSync(join(root, '.gitignore'), '.env\n');
    git(root, 'init'); git(root, 'add', '.'); git(root, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-m', 'original');
    const sha = git(root, 'rev-parse', 'HEAD');
    writeFileSync(join(root, state === 'partial' ? '.env' : 'source.txt'), 'private-fixture');
    const result = spawnSync(process.execPath, [join(repo, 'scripts/maintain-instance.mjs'), root], { encoding: 'utf8', timeout: 30000 });
    assert.equal(result.status, 1);
    assert.match(result.stderr, state === 'partial' ? /partial instance/i : /tracked source/i);
    assert.doesNotMatch(result.stdout + result.stderr, /private-fixture/);
    assert.equal(git(root, 'rev-parse', 'HEAD'), sha);
    assert.equal(readFileSync(join(root, state === 'partial' ? '.env' : 'source.txt'), 'utf8'), 'private-fixture');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// Exercise real setup/backup/update CLIs. Only npm build/install and OS commands
// are fixture programs; native dependency/build/browser acceptance is separate QA.
test('fresh maintenance initializes, builds docs and starts; later update preserves state and failed build stays stopped', async () => {
  const { cpSync, symlinkSync, existsSync } = await import('node:fs');
  const allocated = mkdtempSync(join(tmpdir(), 'portal-maintenance-flow-'));
  const tools = join(allocated, 'tools'), root = join(allocated, 'app'), bin = join(allocated, 'bin');
  mkdirSync(tools); mkdirSync(bin);
  try {
    for (const entry of ['scripts', 'src', 'prisma', 'docs', '.env.example']) cpSync(join(repo, entry), join(tools, entry), { recursive: true, filter: path => !/\.db(?:-|$)/.test(path) });
    writeFileSync(join(tools, '.gitignore'), 'node_modules/\n.env\nconfig/*.local.json\nprisma/*.db*\n.next/\nbuild/\nruntime/\n');
    writeFileSync(join(tools, 'package.json'), '{"name":"fixture","version":"1.0.0"}');
    writeFileSync(join(tools, 'package-lock.json'), '{"name":"fixture","lockfileVersion":3,"packages":{}}');
    const docs = join(allocated, 'docs'); mkdirSync(docs); writeFileSync(join(docs, 'overview.html'), 'preserved native page');
    const helper = join(tools, 'scripts', process.platform === 'win32' ? 'instance-service.ps1' : 'instance-service.sh');
    // Real native helper with only OS service queries/actions replaced.
    let native = readFileSync(helper, 'utf8');
    if (process.platform === 'win32') {
      const declarationsEnd = native.indexOf("$ErrorActionPreference");
      native = native.slice(0, declarationsEnd) + `
function Get-ScheduledTask { [pscustomobject]@{ State='Ready'; Actions=@([pscustomobject]@{WorkingDirectory=$Installation}); Settings=[pscustomobject]@{Enabled=$true} } }
function Disable-ScheduledTask {}
function Enable-ScheduledTask {}
function Stop-ScheduledTask { if ($env:FAIL_STOP -eq 'yes') { throw 'Synthetic stop failure' }; Add-Content -LiteralPath $env:EVENTS -Value 'stop' }
function Start-ScheduledTask { Add-Content -LiteralPath $env:EVENTS -Value 'start' }
function Get-NetTCPConnection { @() }
` + native.slice(declarationsEnd);
      native = native.replace('C:\\CloudSharePortalDocs', docs);
    } else {
      native = native.replace('/var/www/cloudshare-portal-docs', docs);
      writeFileSync(join(bin, 'sudo'), '#!/bin/sh\nexec "$@"\n', { mode: 0o700 });
      writeFileSync(join(bin, 'ss'), '#!/bin/sh\nexit 0\n', { mode: 0o700 });
      writeFileSync(join(bin, 'systemctl'), '#!/bin/sh\ncase "$1" in show) printf "%s\\n" "$INSTALLATION";; stop) [ "$FAIL_STOP" != yes ] || exit 9; printf "stop\\n" >> "$EVENTS";; start) printf "start\\n" >> "$EVENTS";; is-active) exit 3;; *) exit 99;; esac\n', { mode: 0o700 });
    }
    writeFileSync(helper, native, { mode: 0o700 });
    git(tools, 'init'); git(tools, 'add', '.');
    const commit = message => git(tools, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-am', message);
    commit('original'); git(allocated, 'clone', tools, root);
    for (const location of [tools, root]) symlinkSync(join(repo, 'node_modules'), join(location, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
    const npmFixture = join(bin, 'npm.cjs');
    writeFileSync(npmFixture, `const fs=require('node:fs');const a=process.argv.slice(2).join(' ');if(a==='ci'||a==='run prisma:generate')process.exit(0);if(a==='run build'){if(fs.existsSync('fail-build')){process.stderr.write('secret-value');process.exit(7)}fs.mkdirSync('.next',{recursive:true});fs.writeFileSync('.next/release','built');process.exit(0)}if(a==='run build:docs'){require('node:child_process').execFileSync(process.execPath,['scripts/build-docs-site.mjs'],{stdio:'pipe'});process.exit(0)}process.exit(95);`);
    writeFileSync(join(bin, process.platform === 'win32' ? 'npm.cmd' : 'npm'), process.platform === 'win32' ? `@echo off\r\n"${process.execPath}" "${npmFixture}" %*\r\nexit /b %errorlevel%\r\n` : `#!/bin/sh\nexec '${process.execPath}' '${npmFixture}' "$@"\n`, { mode: 0o700 });
    const events = join(allocated, 'events');
    const run = (failure = {}) => spawnSync(process.execPath, [join(tools, 'scripts/maintain-instance.mjs'), root], { encoding: 'utf8', timeout: 180000, env: { ...process.env, PATH: `${bin}${process.platform === 'win32' ? ';' : ':'}${process.env.PATH}`, EVENTS: events, INSTALLATION: root, ...failure } });
    writeFileSync(join(tools, 'release.txt'), 'fresh release'); git(tools, 'add', '.'); commit('fresh release');
    const initialHead = git(root, 'rev-parse', 'HEAD');
    let result = run({ FAIL_STOP: 'yes' });
    assert.equal(result.status, 1); assert.match(result.stderr, /stopping the existing app/);
    assert.equal(git(root, 'rev-parse', 'HEAD'), initialHead); assert.equal(existsSync(join(root, '.env')), false);
    result = run();
    assert.equal(result.status, 0, result.stderr);
    assert.equal(existsSync(join(root, '.env')), true);
    assert.equal(existsSync(join(root, '.next/release')), true);
    assert.equal(existsSync(join(docs, 'quick-start.html')), true);
    assert.equal(readFileSync(join(docs, 'overview.html'), 'utf8'), 'preserved native page');
    assert.deepEqual(readFileSync(events, 'utf8').trim().split(/\r?\n/), ['stop', 'start']);
    const originalEnv = readFileSync(join(root, '.env')); const originalSeed = readFileSync(join(root, 'config/portal-seed.local.json'));
    writeFileSync(join(tools, 'release.txt'), 'updated'); git(tools, 'add', '.'); commit('next release');
    result = run(); assert.equal(result.status, 0, result.stderr);
    assert.equal(git(root, 'rev-parse', 'HEAD'), git(tools, 'rev-parse', 'HEAD'));
    assert.deepEqual(readFileSync(join(root, '.env')), originalEnv); assert.deepEqual(readFileSync(join(root, 'config/portal-seed.local.json')), originalSeed);
    writeFileSync(join(tools, 'fail-build'), 'fail'); git(tools, 'add', '.'); commit('broken build');
    result = run(); assert.equal(result.status, 1); assert.match(result.stderr, /KEEP THE APPLICATION STOPPED/); assert.doesNotMatch(result.stdout + result.stderr, /secret-value/);
    assert.deepEqual(readFileSync(join(root, '.env')), originalEnv);
    assert.deepEqual(readFileSync(events, 'utf8').trim().split(/\r?\n/), ['stop', 'start', 'stop', 'start', 'stop']);
  } finally { rmSync(allocated, { recursive: true, force: true, maxRetries: 4, retryDelay: 100 }); }
});
