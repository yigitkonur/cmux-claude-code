import { existsSync, readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const FWD_SOCK = '/tmp/cmux-fwd.sock';

/**
 * Query the cmux socket synchronously via socat.
 * Used only as a last-resort fallback in loadForwardedEnv().
 */
function querySocket(socketPath: string, command: string, timeoutMs = 500): string {
  try {
    return execSync(
      `echo '${command}' | socat - UNIX-CONNECT:"${socketPath}" 2>/dev/null`,
      { encoding: 'utf-8', timeout: timeoutMs },
    ).trim();
  } catch {
    return '';
  }
}

/**
 * Load cmux env. Handles both local and SSH/remote sessions.
 *
 * Local: CMUX_SOCKET_PATH + CMUX_WORKSPACE_ID set by cmux → use them.
 * SSH with SendEnv/AcceptEnv: correct workspace ID forwarded per-connection.
 * ET/mosh: env file at /tmp/cmux-fwd.env written before connection.
 *
 * IMPORTANT: current_workspace returns the FOCUSED workspace, not the
 * workspace containing the SSH tab. We only use it as absolute last resort.
 */
function isTcpAddress(addr: string): boolean {
  return addr.includes(':') && !addr.startsWith('/');
}

function loadForwardedEnv(): void {
  const socketPath = process.env['CMUX_SOCKET_PATH'] || '';
  const workspaceId = process.env['CMUX_WORKSPACE_ID'] || '';

  // Case 0: cmux ssh — TCP relay address (127.0.0.1:PORT). Trust it.
  if (socketPath && workspaceId && isTcpAddress(socketPath)) {
    return;
  }

  // Case 1: local cmux with valid workspace ID (not forwarded socket)
  if (socketPath && workspaceId && socketPath !== FWD_SOCK) {
    return;
  }

  // Case 2: forwarded socket exists (SSH/ET session)
  if (existsSync(FWD_SOCK)) {
    process.env['CMUX_SOCKET_PATH'] = FWD_SOCK;

    // Workspace ID already set (via SSH AcceptEnv or env file in .zshrc)
    if (workspaceId) {
      // Trust it — it came from the originating tab's environment
      return;
    }

    // No workspace ID at all — last resort: try env file directly
    // (handles case where .zshrc detection didn't run, e.g. non-login shell)
    try {
      const envContent = readFileSync('/tmp/cmux-fwd.env', 'utf-8');
      const widMatch = envContent.match(/CMUX_WORKSPACE_ID=(\S+)/);
      const sidMatch = envContent.match(/CMUX_SURFACE_ID=(\S+)/);
      if (widMatch?.[1]) {
        process.env['CMUX_WORKSPACE_ID'] = widMatch[1];
      }
      if (sidMatch?.[1] && !process.env['CMUX_SURFACE_ID']) {
        process.env['CMUX_SURFACE_ID'] = sidMatch[1];
      }
    } catch {
      // No env file — fall back to current_workspace (may target wrong tab)
      const wid = querySocket(FWD_SOCK, 'current_workspace');
      if (wid && !wid.startsWith('ERROR')) {
        process.env['CMUX_WORKSPACE_ID'] = wid;
      } else {
        delete process.env['CMUX_WORKSPACE_ID'];
      }
    }
    return;
  }

  // Case 3: no forwarded socket — check if env vars point to valid socket
  if (socketPath && existsSync(socketPath) && workspaceId) {
    return;
  }
}

// Load on module import
loadForwardedEnv();

export function isCmuxAvailable(): boolean {
  return !!(process.env['CMUX_SOCKET_PATH'] && process.env['CMUX_WORKSPACE_ID']);
}

export interface CmuxEnv {
  socketPath: string;
  workspaceId: string;
  surfaceId: string;
}

export function getCmuxEnv(): CmuxEnv {
  return {
    socketPath: process.env['CMUX_SOCKET_PATH'] ?? '',
    workspaceId: process.env['CMUX_WORKSPACE_ID'] ?? '',
    surfaceId: process.env['CMUX_SURFACE_ID'] ?? '',
  };
}

export const CMUX_BIN: string = process.env['CMUX_BIN'] ?? 'cmux';
