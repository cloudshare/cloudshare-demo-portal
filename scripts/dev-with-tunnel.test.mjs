import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { runLocalDemo } from './dev-with-tunnel.mjs';

function harness() {
  const controller = new AbortController();
  const messages = [];
  const children = [];
  const operations = [];
  const system = {
    async preflight() { operations.push('preflight'); },
    spawn(kind) {
      operations.push(`start ${kind}`);
      const child = new EventEmitter();
      child.kind = kind;
      children.push(child);
      return child;
    },
    async ready(kind) { operations.push(`ready ${kind}`); return true; },
    async stop(child) { operations.push(`stop ${child.kind}`); },
  };
  return { controller, messages, children, operations, system,
    run: () => runLocalDemo({ system, signal: controller.signal, log: message => {
      messages.push(message);
      if (message.includes('connector ready')) controller.abort();
    } }),
  };
}

test('starts the portal before the tunnel and stops owned children on shutdown', async () => {
  const h = harness();
  assert.equal(await h.run(), 0);
  assert.deepEqual(h.operations, ['preflight', 'start portal', 'ready portal', 'start tunnel', 'ready tunnel', 'stop tunnel', 'stop portal']);
  assert.match(h.messages.join('\n'), /localhost:3000/);
});

test('preflight failure starts nothing and prints only a safe actionable diagnostic', async () => {
  const h = harness();
  h.system.preflight = async () => { throw new Error('secret private.example token=private'); };
  assert.equal(await h.run(), 1);
  assert.deepEqual(h.children, []);
  assert.doesNotMatch(h.messages.join('\n'), /private|secret/);
  assert.match(h.messages.join('\n'), /preflight/);
});

test('portal early exit fails promptly and does not start the tunnel', async () => {
  const h = harness();
  h.system.ready = async () => {
    h.children[0].emit('exit', 7, null);
    return false;
  };
  assert.equal(await h.run(), 1);
  assert.equal(h.children.length, 1);
  assert.match(h.messages.join('\n'), /portal.*exited.*7/);
  assert.deepEqual(h.operations.slice(-1), ['stop portal']);
});

test('readiness timeout fails without announcing success and cleans up the portal', async () => {
  const h = harness();
  h.system.ready = async () => false;
  const code = await runLocalDemo({ system: h.system, signal: h.controller.signal, log: m => h.messages.push(m), startupTimeoutMs: 20, pollMs: 1 });
  assert.equal(code, 1);
  assert.equal(h.children.length, 1);
  assert.match(h.messages.join('\n'), /portal readiness timed out/);
  assert.doesNotMatch(h.messages.join('\n'), /connector ready/);
});

test('tunnel spawn failure is redacted and both owned children are stopped', async () => {
  const h = harness();
  h.system.ready = async kind => {
    if (kind === 'tunnel') h.children[1].emit('error', new Error('token=private'));
    return true;
  };
  assert.equal(await h.run(), 1);
  assert.match(h.messages.join('\n'), /tunnel could not start/);
  assert.doesNotMatch(h.messages.join('\n'), /private|connector ready/);
  assert.deepEqual(h.operations.slice(-2), ['stop tunnel', 'stop portal']);
});

test('cleanup attempts every owned child even if stopping the tunnel fails', async () => {
  const h = harness();
  h.system.stop = async child => {
    h.operations.push(`stop ${child.kind}`);
    if (child.kind === 'tunnel') throw new Error('secret');
  };
  assert.equal(await h.run(), 1);
  assert.deepEqual(h.operations.slice(-2), ['stop tunnel', 'stop portal']);
  assert.match(h.messages.join('\n'), /cleanup failed/);
  assert.doesNotMatch(h.messages.join('\n'), /secret/);
});

test('missing cloudflared executable reports install guidance before starting processes', async () => {
  const { createLocalSystem } = await import('./dev-with-tunnel.mjs');
  const h = harness();
  const system = createLocalSystem({ cloudflared: 'Z:/does-not-exist/cloudflared.exe' });
  assert.equal(await runLocalDemo({ system, signal: h.controller.signal, log: m => h.messages.push(m) }), 1);
  assert.match(h.messages.join('\n'), /cloudflared.*install|install.*cloudflared/i);
});

test('missing existing local configuration gives setup guidance without reading credentials', async () => {
  const { createLocalSystem } = await import('./dev-with-tunnel.mjs');
  const h = harness();
  const system = createLocalSystem({ home: 'Z:/missing-home', processes: { execFile: async () => ({ stdout: '' }) } });
  assert.equal(await runLocalDemo({ system, signal: h.controller.signal, log: m => h.messages.push(m) }), 1);
  assert.match(h.messages.join('\n'), /existing.*config/i);
});

test('preexisting cloudflared is a conflict and never receives a stop command', async t => {
  const { mkdtemp, mkdir, writeFile, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { createLocalSystem } = await import('./dev-with-tunnel.mjs');
  const home = await mkdtemp(join(tmpdir(), 'portal-launcher-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  await mkdir(join(home, '.cloudflared'));
  await writeFile(join(home, '.cloudflared/config.yml'), 'synthetic');
  const calls = [];
  const system = createLocalSystem({ home, processes: {
    execFile: async (command, args) => { calls.push(args); return { stdout: args.includes('--version') ? '' : 'cloudflared.exe' }; },
    spawn: () => { throw new Error('must not spawn'); },
  } });
  const messages = [];
  assert.equal(await runLocalDemo({ system, signal: new AbortController().signal, log: m => messages.push(m) }), 1);
  assert.match(messages.join('\n'), /already running/);
  assert.equal(calls.some(args => args.includes('/PID')), false);
});

test('occupied portal port is reported and the existing HTTP server stays alive', async t => {
  const { createServer } = await import('node:http');
  const { mkdtemp, mkdir, writeFile, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { createLocalSystem } = await import('./dev-with-tunnel.mjs');
  const home = await mkdtemp(join(tmpdir(), 'portal-launcher-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  await mkdir(join(home, '.cloudflared'));
  await writeFile(join(home, '.cloudflared/config.yml'), 'synthetic');
  const server = createServer((req, res) => res.end('existing'));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const port = server.address().port;
  const system = createLocalSystem({ home, portalPort: port, processes: { execFile: async () => ({ stdout: '' }) } });
  const messages = [];
  assert.equal(await runLocalDemo({ system, signal: new AbortController().signal, log: m => messages.push(m) }), 1);
  assert.match(messages.join('\n'), /port.*in use/i);
  assert.equal(await (await fetch(`http://127.0.0.1:${port}`)).text(), 'existing');
});

test('HTTP readiness requires a healthy persisted portal response and connector HTTP 200', async t => {
  const { createServer } = await import('node:http');
  const { createLocalSystem } = await import('./dev-with-tunnel.mjs');
  let body = { status: 'ok', persistenceVerified: false };
  let status = 200;
  const server = createServer((req, res) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const port = server.address().port;
  const system = createLocalSystem({ portalPort: port, metricsPort: port });
  assert.equal(await system.ready('portal'), false);
  body = { status: 'ok', persistenceVerified: true };
  assert.equal(await system.ready('portal'), true);
  assert.equal(await system.ready('tunnel'), true);
  status = 503;
  assert.equal(await system.ready('tunnel'), false);
});

test('adapter starts checkout-local Next and the existing named tunnel without forwarding child output', async () => {
  const { createLocalSystem } = await import('./dev-with-tunnel.mjs');
  const calls = [];
  const system = createLocalSystem({ cwd: 'D:/synthetic-checkout', cloudflared: 'synthetic-cloudflared', processes: { spawn: (...args) => { calls.push(args); return new EventEmitter(); } } });
  system.spawn('portal');
  system.spawn('tunnel');
  assert.equal(calls[0][0], process.execPath);
  assert.match(calls[0][1][0], /synthetic-checkout.*next.*bin.*next/);
  assert.deepEqual(calls[0][1].slice(1), ['dev', '-p', '3000']);
  assert.equal(calls[0][2].cwd, 'D:/synthetic-checkout');
  assert.equal(calls[0][2].env, process.env);
  assert.equal(calls[0][2].stdio, 'ignore');
  assert.deepEqual(calls[1][1], ['tunnel', '--no-autoupdate', '--metrics', '127.0.0.1:20246', 'run', 'cloudshare-webhooks-dev']);
  assert.equal(calls[1][2].stdio, 'ignore');
});

test('OS adapter stops an owned real child and refuses an unrelated child', async t => {
  const { spawn } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const { execFile } = await import('node:child_process');
  const { createLocalSystem } = await import('./dev-with-tunnel.mjs');
  const system = createLocalSystem({ processes: {
    execFile: promisify(execFile),
    spawn: () => spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore', windowsHide: true, detached: process.platform !== 'win32' }),
  } });
  const owned = system.spawn('portal');
  const unrelated = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore', windowsHide: true });
  t.after(() => { owned.kill(); unrelated.kill(); });
  await Promise.all([new Promise(resolve => owned.once('spawn', resolve)), new Promise(resolve => unrelated.once('spawn', resolve))]);
  await assert.rejects(() => system.stop(unrelated));
  assert.equal(unrelated.exitCode, null);
  await system.stop(owned);
  assert.ok(owned.exitCode !== null || owned.signalCode !== null);
});

test('Windows default lookup tries the standard installed location when PATH lacks cloudflared', { skip: process.platform !== 'win32' }, async () => {
  const { createLocalSystem } = await import('./dev-with-tunnel.mjs');
  const commands = [];
  const system = createLocalSystem({ home: 'Z:/missing-home', processes: { execFile: async command => {
    commands.push(command);
    if (command === 'cloudflared') throw new Error('ENOENT');
    return { stdout: '' };
  } } });
  await assert.rejects(() => system.preflight(), /Missing existing/);
  assert.match(commands[1], /Program Files \(x86\).*cloudflared.*cloudflared.exe/i);
});
