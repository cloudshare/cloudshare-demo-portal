import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const cli = fileURLToPath(new URL('./update-instance.mjs', import.meta.url));
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
