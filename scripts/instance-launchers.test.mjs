import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
const repo = dirname(dirname(fileURLToPath(import.meta.url)));
for (const windows of [true, false]) for (const failure of ['none', 'download', 'maintenance']) {
  test(`${windows ? 'Windows' : 'Ubuntu'} permanent launcher: ${failure}`, { skip: windows !== (process.platform === 'win32') }, () => {
    const root = mkdtempSync(join(tmpdir(), 'portal-launcher-'));
    try {
      const bin = join(root, 'bin'); mkdirSync(bin);
      const launcher = join(root, windows ? 'Initialize-Portal.cmd' : 'initialize-portal.sh');
      let source = readFileSync(join(repo, 'scripts', windows ? 'Initialize-Portal.cmd' : 'initialize-portal.sh'), 'utf8');
      source = source.replace(windows ? 'C:\\Program Files\\nodejs' : '/home/sysadmin/.local/node-v24.22.2-linux-x64/bin', bin);
      source = source.replace('C:\\Program Files\\Git\\cmd', bin);
      const events = join(root, 'events');
      const fixture = join(root, 'download.cjs');
      writeFileSync(fixture, `const fs=require('node:fs'),p=require('node:path');const a=process.argv.slice(2);if(a.slice(0,-1).join(' ')!=='clone --single-branch --branch main -- https://github.com/cloudshare/cloudshare-demo-portal.git')process.exit(91);if(process.env.FAILURE==='download')process.exit(23);const d=a.at(-1);fs.mkdirSync(p.join(d,'scripts'),{recursive:true});fs.writeFileSync(p.join(d,'scripts','maintain-instance.mjs'),"import fs from 'node:fs';fs.writeFileSync(process.env.EVENTS, 'maintenance');process.exit(process.env.FAILURE==='maintenance'?29:0);");`);
      writeFileSync(join(bin, windows ? 'git.cmd' : 'git'), windows
        ? `@echo off\r\n"${process.execPath}" "${fixture}" %*\r\nexit /b %errorlevel%\r\n`
        : `#!/bin/sh\nexec '${process.execPath}' '${fixture}' "$@"\n`, { mode: 0o700 });
      writeFileSync(launcher, source, { mode: 0o700 });
      const result = spawnSync(windows ? 'cmd.exe' : '/bin/bash', windows ? ['/d', '/c', launcher] : [launcher], {
        encoding: 'utf8', input: '\r\n', timeout: 15000, windowsHide: true,
        env: { ...process.env, PATH: `${bin}${windows ? ';' : ':'}${process.env.PATH}`, HOME: root, USERPROFILE: root, FAILURE: failure, EVENTS: events },
      });
      assert.equal(result.error, undefined);
      assert.equal(result.status === 0, failure === 'none', result.stdout + result.stderr);
      assert.equal(existsSync(events), failure !== 'download');
      assert.equal(existsSync(launcher), true, 'launcher remains available for another invocation');
    } finally { rmSync(root, { recursive: true, force: true, maxRetries: 3 }); }
  });
}

