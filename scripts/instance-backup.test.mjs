import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const cli = fileURLToPath(new URL('./instance-backup.mjs', import.meta.url));

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
