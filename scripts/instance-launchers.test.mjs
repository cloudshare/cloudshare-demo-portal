import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const fixtures = join(repo, 'build', 'instance-launcher-tests');
const cases = [
  { name: 'setup failure prevents service start and remains a failure', setupExit: 23, serviceExit: 0, events: ['setup'], succeeds: false },
  { name: 'successful setup starts the existing service exactly once', setupExit: 0, serviceExit: 0, events: ['setup', 'service'], succeeds: true },
  { name: 'service start failure remains a failure', setupExit: 0, serviceExit: 29, events: ['setup', 'service'], succeeds: false },
  { name: 'canonical script remains after success', setupExit: 0, serviceExit: 0, events: ['setup', 'service'], succeeds: true, canonical: true },
];

function replaceOnce(source, literal, replacement) {
  assert.equal(source.split(literal).length - 1, 1, `Expected exactly one fixture substitution for ${literal}`);
  return source.replace(literal, replacement);
}

for (const windows of [true, false]) for (const scenario of cases) {
  test(`${windows ? 'Windows' : 'Ubuntu'} launcher: ${scenario.name}`, { skip: windows !== (process.platform === 'win32') }, () => {
    // Read before creating fixtures: RED on a missing launcher cannot execute anything.
    let source = readFileSync(join(repo, 'scripts', windows ? 'Initialize-Portal.cmd' : 'initialize-portal.sh'), 'utf8');
    mkdirSync(fixtures, { recursive: true });
    const root = mkdtempSync(join(fixtures, 'case-'));
    try {
      const bin = join(root, 'bin');
      mkdirSync(bin);
      const events = join(root, 'events.txt');
      const env = {
        ...process.env,
        PORTAL_LAUNCHER_TEST_EVENTS: events,
        PORTAL_LAUNCHER_TEST_SETUP_EXIT: String(scenario.setupExit),
        PORTAL_LAUNCHER_TEST_SERVICE_EXIT: String(scenario.serviceExit),
      };
      let result;
      const launcher = join(root, windows ? 'Initialize-Portal.cmd' : 'initialize-portal.sh');
      source = replaceOnce(source, windows ? 'C:\\Users\\Public\\Desktop\\Initialize-Portal.cmd' : '/home/sysadmin/initialize-portal.sh', scenario.canonical ? join(root, 'deployed-copy') : launcher);
      if (windows) {
        source = replaceOnce(source, 'C:\\CloudShareDemoPortal', root);
        source = replaceOnce(source, 'C:\\Program Files\\nodejs', bin);
        // Windows cannot execute a .cmd stub named .exe. Only this fixture copy
        // substitutes the service executable; production has no testing switches.
        source = replaceOnce(source, 'powershell.exe', `call "${join(bin, 'service.cmd')}"`);
        writeFileSync(join(bin, 'npm.cmd'), '@echo off\r\nif not "%~1"=="run" exit /b 91\r\nif not "%~2"=="setup:instance" exit /b 91\r\nif not "%~3"=="" exit /b 91\r\n>>"%PORTAL_LAUNCHER_TEST_EVENTS%" echo setup\r\nexit /b %PORTAL_LAUNCHER_TEST_SETUP_EXIT%\r\n');
        writeFileSync(join(bin, 'service.cmd'), '@echo off\r\necho %*|findstr /c:"Start-ScheduledTask" >nul\r\nif errorlevel 1 exit /b 92\r\necho %*|findstr /c:"issue489-next" >nul\r\nif errorlevel 1 exit /b 92\r\n>>"%PORTAL_LAUNCHER_TEST_EVENTS%" echo service\r\nexit /b %PORTAL_LAUNCHER_TEST_SERVICE_EXIT%\r\n');
        writeFileSync(launcher, source);
        result = spawnSync('cmd.exe', ['/d', '/c', launcher], { cwd: root, env, input: '\r\n', encoding: 'utf8', windowsHide: true, timeout: 10_000 });
      } else {
        source = replaceOnce(source, '/home/sysadmin/cloudshare-demo-portal', root);
        source = replaceOnce(source, '/home/sysadmin/.local/node-v24.22.2-linux-x64/bin', bin);
        writeFileSync(join(bin, 'npm'), '#!/bin/sh\n[ "$#" = 2 ] && [ "$1" = run ] && [ "$2" = setup:instance ] || exit 91\nprintf "setup\\n" >> "$PORTAL_LAUNCHER_TEST_EVENTS"\nexit "$PORTAL_LAUNCHER_TEST_SETUP_EXIT"\n', { mode: 0o700 });
        writeFileSync(join(bin, 'sudo'), '#!/bin/sh\n[ "$#" = 3 ] && [ "$1" = systemctl ] && [ "$2" = start ] && [ "$3" = issue489-next.service ] || exit 92\nprintf "service\\n" >> "$PORTAL_LAUNCHER_TEST_EVENTS"\nexit "$PORTAL_LAUNCHER_TEST_SERVICE_EXIT"\n', { mode: 0o700 });
        writeFileSync(launcher, source, { mode: 0o700 });
        result = spawnSync('/bin/bash', [launcher], { cwd: root, env, encoding: 'utf8', timeout: 10_000 });
      }
      assert.equal(result.error, undefined, 'Synthetic launcher must finish without a timeout');
      assert.equal(result.status === 0, scenario.succeeds);
      const trace = existsSync(events) ? readFileSync(events, 'utf8').trim().split(/\r?\n/) : [];
      assert.deepEqual(trace, scenario.events);
      assert.equal(existsSync(launcher), !scenario.succeeds || !!scenario.canonical, 'Only the deployed launcher removes itself after setup and service start succeed');
    } finally {
      assert.equal(dirname(root), fixtures);
      rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    }
  });
}
