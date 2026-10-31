import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pages = ['index', 'authentication', 'certification-admin', 'certification-candidate',
  'coverage', 'endpoints', 'operations', 'sales-configuration', 'sales-sessions',
  'sales-trial', 'trial-administration', 'installation'];

function fixture(t) {
  mkdirSync(path.join(root, 'build'), { recursive: true });
  const dir = mkdtempSync(path.join(root, 'build', 'docs-test-'));
  t.after(() => {
    const resolved = realpathSync(dir);
    assert.equal(path.dirname(resolved), realpathSync(path.join(root, 'build')));
    rmSync(resolved, { recursive: true, force: true });
  });
  mkdirSync(path.join(dir, 'scripts'));
  cpSync(path.join(root, 'scripts/build-docs-site.mjs'), path.join(dir, 'scripts/build-docs-site.mjs'));
  cpSync(path.join(root, 'docs/flows'), path.join(dir, 'docs/flows'), { recursive: true });
  mkdirSync(path.join(dir, 'docs/implementation'), { recursive: true });
  cpSync(path.join(root, 'docs/implementation/two-os-installation.md'), path.join(dir, 'docs/implementation/two-os-installation.md'));
  return { dir, build: () => execFileSync(process.execPath, ['scripts/build-docs-site.mjs'], { cwd: dir, encoding: 'utf8', stdio: 'pipe' }),
    read: name => readFileSync(path.join(dir, 'build/docs-site', name), 'utf8') };
}

test('CLI publishes exactly the reviewed pages with working navigation, tables and escaped fences', t => {
  const f = fixture(t);
  f.build();
  assert.deepEqual(readdirSync(path.join(f.dir, 'build/docs-site')).sort(), [...pages.map(p => `${p}.html`), 'style.css'].sort());
  const html = f.read('index.html');
  assert.match(html, /<table>/);
  assert.match(html, /<code class="language-mermaid">/);
  assert.match(html, /href="sales-trial.html"/);
  assert.match(f.read('sales-trial.html'), /id="the-entry-request-exactly-in-order"/);
  assert.match(f.read('coverage.html'), /href="sales-trial.html#the-entry-request-exactly-in-order"/);
  for (const page of pages) {
    const body = f.read(`${page}.html`);
    for (const [, href] of body.matchAll(/href="([^"#]+)(?:#[^"]*)?"/g)) {
      if (!/^https?:/.test(href) && href !== '/login') assert.ok(readdirSync(path.join(f.dir, 'build/docs-site')).includes(href), href);
    }
    assert.doesNotMatch(body, /<script\b|<img\b|href="[^\"]*\.md(?:#|\")/);
  }
});

test('unselected files and unsafe Markdown never become published content or active URLs', t => {
  const f = fixture(t);
  for (const file of ['README.md', '.env', '.git/config', 'prisma/dev.db', 'src/private.ts', 'docs/private.md']) {
    mkdirSync(path.dirname(path.join(f.dir, file)), { recursive: true });
    writeFileSync(path.join(f.dir, file), 'PRIVATE_SENTINEL_DO_NOT_PUBLISH');
  }
  const source = path.join(f.dir, 'docs/flows/README.md');
  writeFileSync(source, readFileSync(source, 'utf8') + `
<script>alert('bad')</script>
<iframe src="https://example.invalid"></iframe>

[source](../../src/private.ts) [env](../../.env) [other](../private.md)
[absolute](/.env) [network](//example.invalid/x) [disk](file:///C:/secret)
[run](javascript:alert(1)) [data](data:text/html,bad)
[credential](https://user:password@example.invalid/x)
![image](https://example.invalid/tracker.png)
[official](https://example.invalid/guide)

## Repeat heading
## Repeat heading
[second](#repeat-heading-1)
`);
  f.build();
  const html = f.read('index.html');
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /href="https:\/\/example.invalid\/guide"/);
  assert.match(html, /id="repeat-heading-1"/);
  assert.match(html, /href="index.html#repeat-heading-1"/);
  assert.doesNotMatch(html, /<script|<iframe|<img|PRIVATE_SENTINEL/);
  assert.doesNotMatch(html, /href="(?:javascript:|data:|file:|\/\/|\/\.env|https:\/\/user:|[^" ]*private)/);
  for (const file of readdirSync(path.join(f.dir, 'build/docs-site'))) {
    assert.doesNotMatch(f.read(file), /PRIVATE_SENTINEL/);
  }
});

test('rebuild removes stale files and invalid selected anchors fail before replacing good output', t => {
  const f = fixture(t);
  f.build();
  writeFileSync(path.join(f.dir, 'build/docs-site/stale-secret.txt'), 'stale');
  f.build();
  assert.ok(!readdirSync(path.join(f.dir, 'build/docs-site')).includes('stale-secret.txt'));
  const good = f.read('index.html');
  const source = path.join(f.dir, 'docs/flows/README.md');
  writeFileSync(source, readFileSync(source, 'utf8') + '\n[broken](sales-trial.md#missing-heading)\n');
  assert.throws(f.build, /Missing selected anchor/);
  assert.equal(f.read('index.html'), good);
});

test('build refuses a redirected output parent before deleting or writing files', t => {
  const f = fixture(t);
  const outside = path.join(f.dir, 'outside');
  mkdirSync(path.join(outside, 'docs-site'), { recursive: true });
  writeFileSync(path.join(outside, 'docs-site/retained.txt'), 'keep');
  symlinkSync(outside, path.join(f.dir, 'build'), 'junction');
  assert.throws(f.build, /Output parent must not be a link/);
  assert.equal(readFileSync(path.join(outside, 'docs-site/retained.txt'), 'utf8'), 'keep');
});
