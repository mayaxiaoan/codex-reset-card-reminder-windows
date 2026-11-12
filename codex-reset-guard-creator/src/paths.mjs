import { homedir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
export const dataDirectory = process.env.RESET_GUARD_CREATOR_HOME || join(homedir(), 'Documents', 'Codex', 'ResetGuardCreator');
export const pipeName = process.platform === 'win32'
  ? '\\\\.\\pipe\\codex-reset-guard-creator-' + createHash('sha256').update(dataDirectory.toLowerCase()).digest('hex').slice(0, 20)
  : join(dataDirectory, 'worker.sock');
