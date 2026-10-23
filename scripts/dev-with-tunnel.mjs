import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';
import { access } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
/** Owns only the two processes started by this invocation. */
export async function runLocalDemo({ system, signal, log = console.log, startupTimeoutMs = 90000, pollMs = 250 }) {
  const owned = [];
  let finish;
  let outcome;
  const ended = new Promise(resolve => { finish = value => { outcome ??= value; resolve(outcome); }; });
  const abort = () => finish({ code: 0 });
  signal.addEventListener('abort', abort, { once: true });
  if (signal.aborted) abort();
  const start = kind => {
    const child = system.spawn(kind);
    owned.push(child);
    child.on('error', () => finish({ code: 1, message: `${kind} could not start. Check its executable and local configuration.` }));
    child.on('exit', code => finish({ code: 1, message: `${kind} exited (code ${Number.isInteger(code) ? code : 'unknown'}). Check its local configuration, credentials and connectivity.` }));
    return child;
  };
  const waitReady = async kind => {
    const deadline = Date.now() + startupTimeoutMs;
    while (!outcome) {
      const ready = await Promise.race([system.ready(kind), ended]);
      if (outcome || ready === true) return;
      if (Date.now() >= deadline) {
        finish({ code: 1, message: `${kind} readiness timed out. Check local configuration, credentials and connectivity.` });
        return;
      }
      await Promise.race([delay(pollMs), ended]);
    }
  };
  try {
    await system.preflight();
    if (outcome) return outcome.code;
    start('portal');
    await waitReady('portal');
    if (outcome) { if (outcome.message) log(outcome.message); return outcome.code; }
    start('tunnel');
    await waitReady('tunnel');
    if (outcome) { if (outcome.message) log(outcome.message); return outcome.code; }
    log('Portal http://localhost:3000 and tunnel connector ready. Public application/webhook delivery is not verified. Ctrl+C stops both.');
    const result = await ended;
    if (result.message) log(result.message);
    return result.code;
  } catch (error) {
    log(error instanceof LauncherError ? error.message : 'Startup preflight failed. Check local installation, configuration and available ports.');
    return 1;
  } finally {
    signal.removeEventListener('abort', abort);
    let cleanupFailed = false;
    for (const child of owned.reverse()) {
      try { await system.stop(child); } catch { cleanupFailed = true; }
    }
    if (cleanupFailed) {
      log('Owned-process cleanup failed. Inspect the processes started by this command before restarting.');
      return 1;
    }
  }
}

class LauncherError extends Error {}

export function createLocalSystem({ cwd = fileURLToPath(new URL('../', import.meta.url)), home = homedir(), portalPort = 3000, metricsPort = 20246, cloudflared = process.env.CLOUDFLARED_PATH || 'cloudflared', processes = { spawn, execFile: promisify(execFile) } } = {}) {
  const owned = new WeakSet();
  return {
    async preflight() {
      try {
        await processes.execFile(cloudflared, ['--version'], { windowsHide: true, timeout: 5000 });
      } catch {
        const fallback = join(process.env['ProgramFiles(x86)'] || 'C:/Program Files (x86)', 'cloudflared/cloudflared.exe');
        if (process.platform !== 'win32' || cloudflared !== 'cloudflared') {
          throw new LauncherError('Cannot run cloudflared. Install it on PATH or set CLOUDFLARED_PATH to its executable.');
        }
        try {
          await processes.execFile(fallback, ['--version'], { windowsHide: true, timeout: 5000 });
          cloudflared = fallback;
        } catch {
          throw new LauncherError('Cannot run cloudflared. Install it on PATH or set CLOUDFLARED_PATH to its executable.');
        }
      }
      const configs = await Promise.allSettled(['config.yml', 'config.yaml'].map(name => access(join(home, '.cloudflared', name))));
      if (!configs.some(result => result.status === 'fulfilled')) {
        throw new LauncherError('Missing existing ~/.cloudflared/config.yml (or config.yaml). Restore the existing named-tunnel configuration and credentials; this command does not provision them.');
      }
      let listing;
      try {
        listing = process.platform === 'win32'
          ? await processes.execFile('tasklist.exe', ['/FO', 'CSV', '/NH'], { windowsHide: true, timeout: 5000 })
          : await processes.execFile('ps', ['-A', '-o', 'comm='], { timeout: 5000 });
      } catch {
        throw new LauncherError('Cannot check existing cloudflared processes. Check OS process-list permissions before retrying.');
      }
      if (/cloudflared(?:\.exe)?/i.test(listing.stdout)) {
        throw new LauncherError('cloudflared is already running. Stop your separately owned connector yourself before using this command; no existing process was changed.');
      }
      for (const port of [portalPort, metricsPort]) {
        try {
          await new Promise((resolve, reject) => {
            const server = createServer();
            server.once('error', reject);
            server.listen({ port, host: '127.0.0.1', exclusive: true }, () => server.close(resolve));
          });
        } catch {
          throw new LauncherError(`Local port ${port} is in use or unavailable. Stop its owner yourself before restarting; this command will not reuse or kill it.`);
        }
      }
    },
    spawn(kind) {
      const command = kind === 'portal' ? process.execPath : cloudflared;
      const args = kind === 'portal'
        ? [join(cwd, 'node_modules/next/dist/bin/next'), 'dev', '-p', String(portalPort)]
        : ['tunnel', '--no-autoupdate', '--metrics', `127.0.0.1:${metricsPort}`, 'run', 'cloudshare-webhooks-dev'];
      const child = processes.spawn(command, args, { cwd, env: process.env, stdio: 'ignore', windowsHide: true, detached: process.platform !== 'win32' });
      owned.add(child);
      return child;
    },
    async stop(child) {
      if (!owned.has(child)) throw new LauncherError('Refusing to stop an unowned process.');
      if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
      if (process.platform === 'win32') {
        try {
          await processes.execFile('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, timeout: 5000 });
        } catch (error) {
          if (child.exitCode === null && child.signalCode === null) throw error;
        }
      } else {
        process.kill(-child.pid, 'SIGTERM');
      }
      if (child.exitCode !== null || child.signalCode !== null) return;
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          child.removeListener('exit', done);
          if (process.platform !== 'win32') { try { process.kill(-child.pid, 'SIGKILL'); } catch { /* Already exited. */ } }
          reject(new LauncherError('Owned-process cleanup timed out.'));
        }, 3000);
        const done = () => { clearTimeout(timer); resolve(); };
        child.once('exit', done);
      });
    },
    async ready(kind) {
      try {
        const response = await fetch(kind === 'portal' ? `http://127.0.0.1:${portalPort}/api/health` : `http://127.0.0.1:${metricsPort}/ready`, { signal: AbortSignal.timeout(2000), redirect: 'error' });
        if (response.status !== 200) { await response.body?.cancel(); return false; }
        if (kind === 'tunnel') { await response.body?.cancel(); return true; }
        const body = await response.json();
        return body.status === 'ok' && body.persistenceVerified === true;
      } catch { return false; }
    },
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  console.log('Starting the local portal, then the existing cloudshare-webhooks-dev connector. Child output is suppressed to protect local configuration.');
  process.exitCode = await runLocalDemo({ system: createLocalSystem(), signal: controller.signal });
  process.removeListener('SIGINT', stop);
  process.removeListener('SIGTERM', stop);
}

