import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function ignored(paths) {
  // Git checks names only: no fixture files, credentials or application imports.
  const result = spawnSync('git', ['check-ignore', '--no-index', '--stdin'], {
    cwd: repo, input: `${paths.join('\n')}\n`, encoding: 'utf8', timeout: 10_000,
    windowsHide: true,
  });
  assert.equal(result.error, undefined);
  assert.ok(result.status === 0 || result.status === 1, result.stderr);
  return result.stdout.trim().split(/\r?\n/).filter(Boolean);
}

test('machine runtime TLS, logs, generated docs, workspaces and temporary files are ignored', () => {
  const paths = [
    'runtime/nginx/cert/server.key', 'runtime/nginx/conf/nginx.conf',
    'runtime/nginx/logs/error.log', 'runtime/docs/installation.html',
    'runtime/logs/ubuntu-next-private.log',
    'runtime/workspaces/Windows.code-workspace', 'runtime/workspaces/CloudSharePortal.code-workspace',
    'runtime/tmp/fixture/output.json',
  ];
  assert.deepEqual(ignored(paths), paths);
});

test('canonical source, scripts and documentation remain trackable', () => {
  assert.deepEqual(ignored([
    'src/config/index.ts', 'scripts/Initialize-Portal.cmd', 'scripts/initialize-portal.sh',
    'docs/implementation/two-os-installation.md',
  ]), []);
});
