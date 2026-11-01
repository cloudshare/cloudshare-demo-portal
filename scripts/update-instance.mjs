// Offline operator workflow. Application stop/start remains operator-owned.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

let refusal;
const fail = message => { refusal = message; throw new Error(); };
const git = (...args) => execFileSync('git', args, { encoding: 'utf8', stdio: 'pipe', windowsHide: true }).trim();

try {
  const [command, bundle, expectedHash, base, target] = process.argv.slice(2);
  if (!['preflight', 'apply'].includes(command) || !bundle || !/^[a-f0-9]{64}$/.test(expectedHash ?? '')) {
    fail('Usage: preflight|apply <bundle> <sha256> <base-sha> <target-sha> <backup-directory> [--app-stopped]');
  }
  const actualHash = createHash('sha256').update(readFileSync(bundle)).digest('hex');
  if (actualHash !== expectedHash) fail('Bundle SHA256 mismatch. No source or instance files were changed.');
  if (!/^[a-f0-9]{40}$/.test(base ?? '') || !/^[a-f0-9]{40}$/.test(target ?? '')) fail('Expected base and target must be full commit SHAs.');
  if (git('rev-parse', 'HEAD') !== base) fail('Checkout does not match the expected base. No source or instance files were changed.');
  if (git('status', '--porcelain', '--untracked-files=no')) fail('Tracked source changes must be resolved before update. No source or instance files were changed.');
  git('bundle', 'verify', bundle);
  const advertised = git('bundle', 'list-heads', bundle).split('\n').map(line => line.trim().split(/\s+/));
  const reference = advertised.find(([sha]) => sha === target)?.[1];
  if (!reference) fail('Pinned target is not advertised by the verified bundle.');
  // Import only objects/FETCH_HEAD; preflight never advances the checkout.
  git('fetch', '--no-tags', '--', bundle, reference);
  if (git('rev-parse', 'FETCH_HEAD^{commit}') !== target) fail('Imported bundle target does not match the pinned commit.');
  if (git('merge-base', base, target) !== base) fail('Pinned target is not a fast-forward of the installed source. No source or instance files were changed.');
  fail('Update workflow is not yet implemented. No source or instance files were changed.');
} catch {
  process.stderr.write(`${refusal ?? 'Update validation failed. Check the bundle and local Git checkout. No source or instance files were changed.'}\n`);
  process.exitCode = 1;
}
