import { createConnection, type Socket } from 'node:net';
import { execFile, execSync } from 'node:child_process';

/**
 * Tokenize a V1 socket command string, respecting double-quoted values.
 * Returns an array of unquoted tokens.
 */
function tokenize(input: string): string[] {
  const tokens: string[] = [];
  let i = 0;
  while (i < input.length) {
    // Skip whitespace
    while (i < input.length && input[i] === ' ') i++;
    if (i >= input.length) break;

    if (input[i] === '"') {
      // Quoted string — collect until closing quote
      i++; // skip opening "
      let token = '';
      while (i < input.length && input[i] !== '"') {
        if (input[i] === '\\' && i + 1 < input.length) {
          token += input[i + 1]; // unescape
          i += 2;
        } else {
          token += input[i];
          i++;
        }
      }
      if (i < input.length) i++; // skip closing "
      tokens.push(token);
    } else {
      // Unquoted token — collect until whitespace
      let token = '';
      while (i < input.length && input[i] !== ' ') {
        token += input[i];
        i++;
      }
      tokens.push(token);
    }
  }
  return tokens;
}

/**
 * Convert a V1 socket text command to cmux CLI args.
 *
 * V1: set_status "codex" "Working" --icon=hammer.fill --color=#4C8DFF --tab=ws:abc
 * CLI: ['set-status', 'codex', 'Working', '--icon', 'hammer.fill', '--color', '4C8DFF', '--workspace', 'ws:abc']
 *
 * Special cases:
 *   notify "T|S|B"            → ['notify', '--title', 'T', '--subtitle', 'S', '--body', 'B']
 *   notify_target W S "T|S|B" → ['notify', '--title', 'T', '--subtitle', 'S', '--body', 'B', '--workspace', 'W']
 *   log --flags -- message    → ['log', '--flags', '--', 'message']
 */
function v1ToCliArgs(command: string): string[] {
  const tokens = tokenize(command);
  if (tokens.length === 0) return [];

  const cmd = tokens[0];

  // Special: notify_target W S "T|S|B"
  if (cmd === 'notify_target' && tokens.length >= 4) {
    const wid = tokens[1];
    // tokens[2] = surfaceId (skip — CLI notify doesn't support surface targeting)
    const parts = tokens[3].split('|');
    const args = ['notify'];
    if (parts[0]) args.push('--title', parts[0]);
    if (parts[1]) args.push('--subtitle', parts[1]);
    if (parts[2]) args.push('--body', parts[2]);
    if (wid) args.push('--workspace', wid);
    return args;
  }

  // Special: notify "T|S|B"
  if (cmd === 'notify' && tokens.length >= 2) {
    const parts = tokens[1].split('|');
    const args = ['notify'];
    if (parts[0]) args.push('--title', parts[0]);
    if (parts[1]) args.push('--subtitle', parts[1]);
    if (parts[2]) args.push('--body', parts[2]);
    return args;
  }

  // General: convert command name and flags
  const cliCmd = cmd.replace(/_/g, '-'); // set_status → set-status
  const args: string[] = [cliCmd];
  let pastSeparator = false;

  for (let i = 1; i < tokens.length; i++) {
    const t = tokens[i];

    if (t === '--') {
      pastSeparator = true;
      args.push('--');
      continue;
    }

    if (pastSeparator) {
      args.push(t);
      continue;
    }

    if (t.startsWith('--')) {
      const eqIdx = t.indexOf('=');
      if (eqIdx === -1) {
        // Flag without value: --status, etc.
        args.push(t.replace(/_/g, '-'));
        continue;
      }

      let key = t.slice(0, eqIdx);
      let val = t.slice(eqIdx + 1);

      // --tab → --workspace
      if (key === '--tab') {
        args.push('--workspace', val);
        continue;
      }

      // --color=#hex → --color hex (strip #)
      if (key === '--color' && val.startsWith('#')) {
        val = val.slice(1);
      }

      // --pid is not a CLI flag — skip it
      if (key === '--pid') continue;

      // Convert underscores in flag names
      key = key.replace(/_/g, '-');

      args.push(key, val);
    } else {
      // Positional arg
      args.push(t);
    }
  }

  return args;
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

  /**
   * Send a command and wait for the response.
   * Returns empty string on any error — never throws.
   */
  async send(command: string): Promise<string> {
    if (this.isTcp) return this.sendCli(command);
    return this.sendUnix(command);
  }

  /**
   * Fire-and-forget: send a command without waiting for response.
   * Swallows all errors silently.
   */
  fire(command: string): void {
    if (this.isTcp) {
      this.fireCli(command);
    } else {
      this.fireUnix(command);
    }
  }

  /**
   * Check if the given workspace is currently focused.
   * Returns false on error — safe default that sends notifications.
   */
  async isFocused(workspaceId: string): Promise<boolean> {
    try {
      const response = this.isTcp
        ? await this.sendCli('identify --json')
        : await this.sendUnix('identify --json');
      if (!response) return false;
      const info = JSON.parse(response);
      return info?.focused?.workspace_id === workspaceId
        || info?.focused_workspace === workspaceId;
    } catch {
      return false;
    }
  }

  /**
   * Fire multiple commands in parallel, each on its own connection.
   */
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
        if (socket) {
          socket.removeAllListeners();
          socket.destroy();
        }
        resolve(result);
      };

      const timer = setTimeout(() => finish(''), 1000);

      try {
        socket = createConnection({ path: this.socketPath }, () => {
          try {
            socket!.write(command + '\n');
          } catch {
            clearTimeout(timer);
            finish('');
          }
        });

        socket.on('data', (chunk: Buffer) => chunks.push(chunk));
        socket.on('end', () => {
          clearTimeout(timer);
          finish(Buffer.concat(chunks).toString('utf-8').trimEnd());
        });
        socket.on('error', () => { clearTimeout(timer); finish(''); });
        socket.on('timeout', () => { clearTimeout(timer); finish(''); });
        socket.setTimeout(1000);
      } catch {
        clearTimeout(timer);
        finish('');
      }
    });
  }

  private fireUnix(command: string): void {
    try {
      const socket = createConnection({ path: this.socketPath }, () => {
        try {
          socket.write(command + '\n', () => socket.destroy());
        } catch {
          socket.destroy();
        }
      });
      socket.on('error', () => socket.destroy());
      socket.setTimeout(1000, () => socket.destroy());
    } catch {
      // Silently ignore — cmux may not be running
    }
  }

  // ---- CLI transport (TCP/SSH path, ~30ms, handles HMAC auth) ----

  private sendCli(command: string): Promise<string> {
    return new Promise<string>((resolve) => {
      try {
        // For 'identify --json', use cmux CLI directly
        if (command === 'identify --json') {
          execFile(this.cmuxBin, ['identify', '--json'], { timeout: 3000 }, (err, stdout) => {
            resolve(err ? '' : (stdout || '').trim());
          });
          return;
        }

        const args = v1ToCliArgs(command);
        if (args.length === 0) { resolve(''); return; }

        execFile(this.cmuxBin, args, { timeout: 3000 }, (err, stdout) => {
          resolve(err ? '' : (stdout || '').trim());
        });
      } catch {
        resolve('');
      }
    });
  }

  private fireCli(command: string): void {
    try {
      const args = v1ToCliArgs(command);
      if (args.length === 0) return;
      execFile(this.cmuxBin, args, { timeout: 3000 }, () => {});
    } catch {
      // Silently ignore
    }
  }
}
