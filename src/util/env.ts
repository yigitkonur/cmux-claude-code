import { readFileSync, existsSync } from 'node:fs';
import { createConnection } from 'node:net';

const ENV_FILE = '/tmp/cmux-fwd.env';
const FWD_SOCK = '/tmp/cmux-fwd.sock';

/**
 * Load cmux env from forwarded env file if env vars aren't set.
 * This handles the SSH case where Claude Code hooks don't inherit
 * shell env vars — the .zshrc sets them but Claude's hook subprocesses
 * don't see them. The env file is written by the local machine's
 * .zshrc and scp'd to the remote.
 */
function loadForwardedEnv(): void {
  // Already have env vars — nothing to do
  if (process.env['CMUX_SOCKET_PATH'] && process.env['CMUX_WORKSPACE_ID']) {
    return;
  }

  // Check for forwarded socket + env file (SSH remote scenario)
  if (existsSync(FWD_SOCK) && existsSync(ENV_FILE)) {
    try {
      const content = readFileSync(ENV_FILE, 'utf-8');
      for (const line of content.split('\n')) {
        const match = line.match(/^export\s+(\w+)=(.+)$/);
        if (match) {
          const [, key, value] = match;
          if (!process.env[key]) {
            process.env[key] = value;
          }
        }
      }
      // Set socket path to the forwarded socket
      if (!process.env['CMUX_SOCKET_PATH']) {
        process.env['CMUX_SOCKET_PATH'] = FWD_SOCK;
      }
    } catch {
      // Best effort — if env file is corrupt, no-op
    }
  }
}

// Load on module import — runs before isCmuxAvailable() is called
loadForwardedEnv();

/**
 * Check whether cmux is reachable — either locally or via forwarded socket.
 */
export function isCmuxAvailable(): boolean {
  return !!(process.env['CMUX_SOCKET_PATH'] && process.env['CMUX_WORKSPACE_ID']);
}

export interface CmuxEnv {
  socketPath: string;
  workspaceId: string;
  surfaceId: string;
}

/**
 * Read cmux environment variables.
 */
export function getCmuxEnv(): CmuxEnv {
  return {
    socketPath: process.env['CMUX_SOCKET_PATH'] ?? '',
    workspaceId: process.env['CMUX_WORKSPACE_ID'] ?? '',
    surfaceId: process.env['CMUX_SURFACE_ID'] ?? '',
  };
}

/**
 * Path to the cmux CLI binary.
 */
export const CMUX_BIN: string = process.env['CMUX_BIN'] ?? 'cmux';
