// Offline operator workflow. Application stop/start remains operator-owned.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

try {
  const [command, bundle, expectedHash] = process.argv.slice(2);
  if (!['preflight', 'apply'].includes(command) || !bundle || !/^[a-f0-9]{64}$/.test(expectedHash ?? '')) {
    throw new Error('Usage: preflight|apply <bundle> <sha256> <base-sha> <target-sha> <backup-directory> [--app-stopped]');
  }
  const actualHash = createHash('sha256').update(readFileSync(bundle)).digest('hex');
  if (actualHash !== expectedHash) throw new Error('Bundle SHA256 mismatch. No source or instance files were changed.');
  throw new Error('Update workflow is not yet implemented. No source or instance files were changed.');
} catch (error) {
  process.stderr.write(`${error.code ? 'Cannot read the update bundle. No source or instance files were changed.' : error.message}\n`);
  process.exitCode = 1;
}
