import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const fixtures = join(repo, 'runtime', 'tmp');
const cases = [
  { name: 'setup failure prevents service start and remains a failure', setupExit: 23, serviceExit: 0, events: ['setup'], succeeds: false },
  { name: 'successful setup starts the existing service exactly once', setupExit: 0, serviceExit: 0, events: ['setup', 'service'], succeeds: true },
  { name: 'service start failure remains a failure', setupExit: 0, serviceExit: 29, events: ['setup', 'service'], succeeds: false },
  { name: 'canonical script remains after success', setupExit: 0, serviceExit: 0, events: ['setup', 'service'], succeeds: true, canonical: true },
  { name: 'ready Windows task starts without an unnecessary stop', setupExit: 0, serviceExit: 0, events: ['setup', 'service'], succeeds: true, ready: true, windowsOnly: true },
];

function replaceOnce(source, literal, replacement) {
  assert.equal(source.split(literal).length - 1, 1, `Expected exactly one fixture substitution for ${literal}`);
  return source.replace(literal, replacement);
}

for (const windows of [true, false]) for (const scenario of cases) {
  test(`${windows ? 'Windows' : 'Ubuntu'} launcher: ${scenario.name}`, { skip: windows !== (process.platform === 'win32') || (!windows && scenario.windowsOnly) }, () => {
    // Read before creating fixtures: RED on a missing launcher cannot execute anything.
    let source = readFileSync(join(repo, 'scripts', windows ? 'Initialize-Portal.cmd' : 'initialize-portal.sh'), 'utf8');
    mkdirSync(fixtures, { recursive: true });
    const root = mkdtempSync(join(fixtures, 'instance-launcher-test-'));
    try {
      const bin = join(root, 'bin');
      mkdirSync(bin);
      const events = join(root, 'events.txt');
      const env = {
        ...process.env,
        PORTAL_LAUNCHER_TEST_EVENTS: events,
        PORTAL_LAUNCHER_TEST_SETUP_EXIT: String(scenario.setupExit),
        PORTAL_LAUNCHER_TEST_SERVICE_EXIT: String(scenario.serviceExit),
        PORTAL_LAUNCHER_TEST_TASK_STATE: scenario.ready ? 'Ready' : 'Running',
      };
      let result;
      const launcher = join(root, windows ? 'Initialize-Portal.cmd' : 'initialize-portal.sh');
      source = replaceOnce(source, windows ? 'C:\\CloudShareDemoPortal' : '/home/sysadmin/cloudshare-demo-portal', root);
      source = replaceOnce(source, windows ? 'C:\\Users\\Public\\Desktop\\Initialize-Portal.cmd' : '/home/sysadmin/initialize-portal.sh', scenario.canonical ? join(root, 'deployed-copy') : launcher);
      if (windows) {
        source = replaceOnce(source, 'C:\\Program Files\\nodejs', bin);
        // Execute the real PowerShell command with task cmdlets replaced only in
        // the disposable copy. IgnoreNew does not reload an already running task.
        const mocks = join(bin, 'tasks.ps1');
        writeFileSync(mocks, `
$script:taskState=$env:PORTAL_LAUNCHER_TEST_TASK_STATE
function Get-ScheduledTask { param([string]$TaskName) if($TaskName -ne 'issue489-next'){throw 'Unexpected task'}; [pscustomobject]@{State=$script:taskState} }
function Stop-ScheduledTask { param([string]$TaskName) if($TaskName -ne 'issue489-next'){throw 'Unexpected task'}; Add-Content -LiteralPath $env:PORTAL_LAUNCHER_TEST_EVENTS -Value 'stop'; $script:taskState='Ready' }
function Start-ScheduledTask { param([string]$TaskName) if($TaskName -ne 'issue489-next'){throw 'Unexpected task'}; if($script:taskState -eq 'Running'){Add-Content -LiteralPath $env:PORTAL_LAUNCHER_TEST_EVENTS -Value 'ignored-start'; return}; Add-Content -LiteralPath $env:PORTAL_LAUNCHER_TEST_EVENTS -Value 'service'; if($env:PORTAL_LAUNCHER_TEST_SERVICE_EXIT -ne '0'){throw 'Synthetic start failure'}; $script:taskState='Running' }
`);
        source = replaceOnce(source, '-Command "', `-Command "$ErrorActionPreference='Stop'; . '${mocks.replaceAll("'", "''")}'; `);
        writeFileSync(join(bin, 'npm.cmd'), '@echo off\r\nif not "%~1"=="run" exit /b 91\r\nif not "%~2"=="setup:instance" exit /b 91\r\nif not "%~3"=="" exit /b 91\r\n>>"%PORTAL_LAUNCHER_TEST_EVENTS%" echo setup\r\nexit /b %PORTAL_LAUNCHER_TEST_SETUP_EXIT%\r\n');
        writeFileSync(launcher, source);
        result = spawnSync('cmd.exe', ['/d', '/c', launcher], { cwd: root, env, input: '\r\n', encoding: 'utf8', windowsHide: true, timeout: 10_000 });
      } else {
        source = replaceOnce(source, '/home/sysadmin/.local/node-v24.22.2-linux-x64/bin', bin);
        writeFileSync(join(bin, 'npm'), '#!/bin/sh\n[ "$#" = 2 ] && [ "$1" = run ] && [ "$2" = setup:instance ] || exit 91\nprintf "setup\\n" >> "$PORTAL_LAUNCHER_TEST_EVENTS"\nexit "$PORTAL_LAUNCHER_TEST_SETUP_EXIT"\n', { mode: 0o700 });
        writeFileSync(join(bin, 'sudo'), '#!/bin/sh\n[ "$#" = 3 ] && [ "$1" = systemctl ] && [ "$2" = restart ] && [ "$3" = issue489-next.service ] || exit 92\nprintf "service\\n" >> "$PORTAL_LAUNCHER_TEST_EVENTS"\nexit "$PORTAL_LAUNCHER_TEST_SERVICE_EXIT"\n', { mode: 0o700 });
        writeFileSync(launcher, source, { mode: 0o700 });
        result = spawnSync('/bin/bash', [scenario.succeeds && !scenario.canonical ? './initialize-portal.sh' : launcher], { cwd: root, env, encoding: 'utf8', timeout: 10_000 });
      }
      assert.equal(result.error, undefined, 'Synthetic launcher must finish without a timeout');
      assert.equal(result.status === 0, scenario.succeeds, `Synthetic launcher status ${result.status}; stdout: ${result.stdout}; stderr: ${result.stderr}`);
      const trace = existsSync(events) ? readFileSync(events, 'utf8').trim().split(/\r?\n/) : [];
      const expectedEvents = windows && scenario.setupExit === 0 && !scenario.ready
        ? ['setup', 'stop', 'service'] : scenario.events;
      assert.deepEqual(trace, expectedEvents);
      assert.equal(existsSync(launcher), !scenario.succeeds || !!scenario.canonical, 'Only the deployed launcher removes itself after setup and service start succeed');
    } finally {
      assert.equal(dirname(root), fixtures);
      rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    }
  });
}
