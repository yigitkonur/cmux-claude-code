import { createConnection, type Socket } from 'node:net';
import { execFile } from 'node:child_process';

/**
 * Convert a V1 socket command to a `cmux rpc` call.
 *
 * Over SSH (TCP relay), the sidebar V1 commands (set_status, log, set_progress, etc.)
 * are NOT available — they are Unix-socket-only. The TCP relay only exposes V2 JSON-RPC.
 *
 * Available V2 methods over SSH (confirmed on cmux 0.63.1):
 *   notification.create, notification.create_for_surface, notification.clear
 *   workspace.action (mark-unread/mark-read), surface.trigger_flash
 *   tab.action (rename), system.identify, system.ping
 *
 * Strategy: map V1 sidebar commands to the best available V2 equivalent.
 *   - set_status  → tab.action rename "[Status] detail"
 *   - clear_status → tab.action rename "" (reset)
 *   - set_progress → (encoded in tab title: "[Working 50%] detail")
 *   - clear_progress → (no-op, title handles it)
 *   - log → (no sidebar log over SSH — swallow silently)
 *   - clear_log → (no-op)
 *   - notify_target → notification.create_for_surface
 *   - notify → notification.create
 *   - clear_notifications → notification.clear
 *   - set_agent_pid → (no equivalent — rely on tab title for status)
 *   - clear_agent_pid → (no-op)
 *   - report_git_branch → (no equivalent)
 *   - report_meta → (no equivalent)
 *   - workspace_action → workspace.action
 */

interface RpcCall {
  method: string;
  params: Record<string, unknown>;
}

/**
 * Tokenize a V1 command string, respecting double-quoted values.
 */
function tokenize(input: string): string[] {
  const tokens: string[] = [];
  let i = 0;
  while (i < input.length) {
    while (i < input.length && input[i] === ' ') i++;
    if (i >= input.length) break;
    if (input[i] === '"') {
      i++;
      let token = '';
      while (i < input.length && input[i] !== '"') {
        if (input[i] === '\\' && i + 1 < input.length) { token += input[i + 1]; i += 2; }
        else { token += input[i]; i++; }
      }
      if (i < input.length) i++;
      tokens.push(token);
    } else {
      let token = '';
      while (i < input.length && input[i] !== ' ') { token += input[i]; i++; }
      tokens.push(token);
    }
  }
  return tokens;
}

/** Extract --key=value flags from tokenized V1 command. */
function extractFlags(tokens: string[]): { positional: string[]; flags: Record<string, string>; message?: string } {
  const positional: string[] = [];
  const flags: Record<string, string> = {};
  let message: string | undefined;
  let pastSep = false;

  for (let i = 1; i < tokens.length; i++) {
    if (tokens[i] === '--') { pastSep = true; continue; }
    if (pastSep) { message = (message ? message + ' ' : '') + tokens[i]; continue; }
    if (tokens[i].startsWith('--')) {
      const eq = tokens[i].indexOf('=');
      if (eq !== -1) flags[tokens[i].slice(2, eq)] = tokens[i].slice(eq + 1);
      else flags[tokens[i].slice(2)] = 'true';
    } else {
      positional.push(tokens[i]);
    }
  }
  return { positional, flags, message };
}

/**
 * Status color map — workspace tab color reflects the current state.
 * This gives visual status feedback over SSH even without sidebar pills.
 */
const STATUS_COLORS: Record<string, string> = {
  '#50C878': '#50C878', // green — ready/done
  '#FFD700': '#FFD700', // gold — thinking
  '#4C8DFF': '#4C8DFF', // blue — working
  '#FF6B35': '#FF6B35', // orange — waiting
  '#FF4444': '#FF4444', // red — error
  '#9B59B6': '#9B59B6', // purple — compacting
};

/**
 * Convert V1 command to V2 RPC calls.
 *
 * Over SSH, sidebar V1 commands have no direct V2 equivalents.
 * Creative workaround using confirmed-working V2 methods:
 *   - set_status → tab.action rename (status in tab title)
 *                + workspace.action set-color (color reflects state)
 *   - clear_status → tab.action clear_name + workspace.action clear-color
 *   - notify_target → notification.create_for_surface
 *   - workspace_action → workspace.action
 *   - log, progress, meta → silently dropped (no V2 equivalent)
 *
 * Returns array of RPC calls (some commands need 2: title + color).
 */
function v1ToRpc(command: string): RpcCall[] {
  const tokens = tokenize(command);
  if (tokens.length === 0) return [];
  const cmd = tokens[0];
  const { positional, flags, message } = extractFlags(tokens);

  switch (cmd) {
    case 'set_status': {
      // set_status key "value" --icon=X --color=#hex --tab=W
      // → tab.action rename (title) + workspace.action set-color (state color)
      const value = positional[1] || '';
      const color = flags['color'] || '';
      const calls: RpcCall[] = [
        { method: 'tab.action', params: { action: 'rename', title: value } },
      ];
      if (color && STATUS_COLORS[color]) {
        calls.push({ method: 'workspace.action', params: { action: 'set-color', color } });
      }
      return calls;
    }

    case 'clear_status':
      return [
        { method: 'tab.action', params: { action: 'clear_name' } },
        { method: 'workspace.action', params: { action: 'clear-color' } },
      ];

    case 'set_progress':
      // Progress not available over SSH — silently skip.
      // The status title from set_status already shows tool info.
      return [];

    case 'clear_progress':
      return [];

    case 'log':
      // No sidebar log over SSH — silently drop
      return [];

    case 'clear_log':
      return [];

    case 'notify': {
      const parts = (positional[0] || '').split('|');
      return [{
        method: 'notification.create',
        params: { title: parts[0] || '', subtitle: parts[1] || '', body: parts[2] || '' },
      }];
    }

    case 'notify_target': {
      const surfaceId = positional[1] || '';
      const parts = (positional[2] || '').split('|');
      return [{
        method: 'notification.create_for_surface',
        params: { surface_id: surfaceId, title: parts[0] || '', subtitle: parts[1] || '', body: parts[2] || '' },
      }];
    }

    case 'clear_notifications':
      return [{ method: 'notification.clear', params: {} }];

    case 'set_agent_pid':
      return []; // No V2 equivalent — cmux crash recovery won't work over SSH

    case 'clear_agent_pid':
      return [];

    case 'report_git_branch':
      return []; // No V2 equivalent

    case 'report_meta':
      return [];

    case 'clear_meta':
      return [];

    case 'reset_sidebar':
      return [
        { method: 'tab.action', params: { action: 'clear_name' } },
        { method: 'workspace.action', params: { action: 'clear-color' } },
      ];

    case 'workspace_action': {
      const action = (flags['action'] || '').replace(/_/g, '-');
      return [{ method: 'workspace.action', params: { action } }];
    }

    default:
      return [];
  }
}

export class CmuxSocket {
  private readonly socketPath: string;
  private readonly isTcp: boolean;
  private readonly cmuxBin: string;

  constructor(socketPath: string, cmuxBin = 'cmux') {
    this.socketPath = socketPath;
    this.cmuxBin = cmuxBin;
    // cmux ssh: CMUX_SOCKET_PATH=127.0.0.1:PORT (TCP relay with HMAC auth)
    // Local cmux: CMUX_SOCKET_PATH=/path/to/cmux.sock (Unix socket, no auth)
    this.isTcp = socketPath.includes(':') && !socketPath.startsWith('/');
  }

  /** Send a command and wait for the response. Never throws. */
  async send(command: string): Promise<string> {
    if (this.isTcp) return this.sendRpc(command);
    return this.sendUnix(command);
  }

  /** Fire-and-forget. Swallows all errors. */
  fire(command: string): void {
    if (this.isTcp) {
      this.fireRpc(command);
    } else {
      this.fireUnix(command);
    }
  }

  /** Check if the given workspace is currently focused. */
  async isFocused(workspaceId: string): Promise<boolean> {
    try {
      let response: string;
      if (this.isTcp) {
        response = await this.execRpc('system.identify', {});
      } else {
        response = await this.sendUnix('identify --json');
      }
      if (!response) return false;
      const info = JSON.parse(response);
      return info?.focused?.workspace_id === workspaceId
        || info?.focused_workspace === workspaceId;
    } catch {
      return false;
    }
  }

  /** Fire multiple commands in parallel. */
  fireAll(commands: string[]): void {
    for (const command of commands) {
      this.fire(command);
    }
  }

  // ---- Unix socket transport (fast path, ~8ms) ----

  private sendUnix(command: string): Promise<string> {
    return new Promise<string>((resolve) => {
      let socket: Socket | null = null;
      let settled = false;
      const chunks: Buffer[] = [];

      const finish = (result: string): void => {
        if (settled) return;
        settled = true;
        if (socket) { socket.removeAllListeners(); socket.destroy(); }
        resolve(result);
      };

      const timer = setTimeout(() => finish(''), 1000);

      try {
        socket = createConnection({ path: this.socketPath }, () => {
          try { socket!.write(command + '\n'); } catch { clearTimeout(timer); finish(''); }
        });
        socket.on('data', (chunk: Buffer) => chunks.push(chunk));
        socket.on('end', () => { clearTimeout(timer); finish(Buffer.concat(chunks).toString('utf-8').trimEnd()); });
        socket.on('error', () => { clearTimeout(timer); finish(''); });
        socket.on('timeout', () => { clearTimeout(timer); finish(''); });
        socket.setTimeout(1000);
      } catch { clearTimeout(timer); finish(''); }
    });
  }

  private fireUnix(command: string): void {
    try {
      const socket = createConnection({ path: this.socketPath }, () => {
        try { socket.write(command + '\n', () => socket.destroy()); }
        catch { socket.destroy(); }
      });
      socket.on('error', () => socket.destroy());
      socket.setTimeout(1000, () => socket.destroy());
    } catch {}
  }

  // ---- RPC transport (SSH/TCP relay, ~30ms, uses cmux rpc) ----

  private execRpc(method: string, params: Record<string, unknown>): Promise<string> {
    return new Promise<string>((resolve) => {
      try {
        const jsonParams = JSON.stringify(params);
        execFile(this.cmuxBin, ['rpc', method, jsonParams], { timeout: 3000 }, (err, stdout) => {
          resolve(err ? '' : (stdout || '').trim());
        });
      } catch { resolve(''); }
    });
  }

  private fireRpc(command: string): void {
    const calls = v1ToRpc(command);
    if (calls.length === 0) return;
    for (const rpc of calls) {
      try {
        const jsonParams = JSON.stringify(rpc.params);
        execFile(this.cmuxBin, ['rpc', rpc.method, jsonParams], { timeout: 3000 }, () => {});
      } catch {}
    }
  }

  private sendRpc(command: string): Promise<string> {
    if (command === 'identify --json') {
      return this.execRpc('system.identify', {});
    }
    const calls = v1ToRpc(command);
    if (calls.length === 0) return Promise.resolve('');
    // Return the result of the first call (most meaningful)
    return this.execRpc(calls[0].method, calls[0].params);
  }
}
