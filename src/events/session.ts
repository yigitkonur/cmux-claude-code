/**
 * Session lifecycle handlers: SessionStart and SessionEnd.
 *
 * SessionStart initializes state, detects git info, sets initial sidebar state.
 * SessionEnd cleans up state and sidebar artifacts.
 */

import type { CmuxSocket } from '../cmux/socket.js';
import type { CmuxCommands } from '../cmux/commands.js';
import type { StateManager } from '../state/manager.js';
import type { CcCmuxConfig } from '../config/types.js';
import type { CmuxEnv } from '../util/env.js';
import type { SessionStartInput, SessionEndInput } from './types.js';
import { STATUS_DISPLAY, formatStatusValue } from '../features/status.js';
import { detectGitInfo } from '../features/git.js';
import { deleteTabTitle } from '../features/tab-title.js';
import { LOG_SOURCE } from '../features/logger.js';
import { hostname } from 'node:os';

const STALE_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Handle SessionStart — initialize the session state and sidebar.
 */
export async function onSessionStart(
  event: SessionStartInput,
  socket: CmuxSocket,
  cmd: CmuxCommands,
  state: StateManager,
  config: CcCmuxConfig,
  env: CmuxEnv,
): Promise<void> {
  // Create and populate initial state
  const s = state.createDefault();
  s.sessionId = event.session_id;
  s.workspaceId = env.workspaceId;
  s.surfaceId = env.surfaceId;
  s.socketPath = env.socketPath;
  s.model = event.model ?? null;
  s.sessionStartTime = Date.now();

  // Detect git info if enabled
  if (config.features.gitIntegration && event.cwd) {
    try {
      const gitInfo = detectGitInfo(event.cwd);
      s.gitBranch = gitInfo.branch;
      s.gitDirty = gitInfo.dirty;
    } catch {
      // Git detection is best-effort
    }
  }

  // Write state before sending socket commands
  state.write(s);

  // Build batch of sidebar initialization commands
  const commands: string[] = [];

  // Register agent PID — enables cmux's 30s crash recovery auto-cleanup
  // and suppresses raw OSC terminal notifications for this workspace
  const pid = process.ppid || process.pid;
  commands.push(cmd.setAgentPid('claude_code', pid));

  // Clear previous state
  commands.push(cmd.clearLog());
  commands.push(cmd.clearNotifications());

  // Set status to Ready
  if (config.features.statusPills) {
    const display = STATUS_DISPLAY.ready;
    commands.push(
      cmd.setStatus('claude_code', formatStatusValue('ready'), {
        icon: display.icon,
        color: display.color,
        pid,
      }),
    );
  }

  // Report git branch
  if (config.features.gitIntegration && s.gitBranch) {
    commands.push(cmd.reportGitBranch(s.gitBranch, s.gitDirty));
  }

  // Detect SSH / remote session
  const isSSH = !!(process.env['SSH_CONNECTION'] || process.env['SSH_CLIENT'] || process.env['SSH_TTY']);
  const hostName = hostname();

  if (isSSH) {
    // Report remote hostname prominently
    const user = process.env['USER'] || process.env['LOGNAME'] || '';
    const hostLabel = user ? `${user}@${hostName}` : hostName;
    commands.push(
      cmd.reportMeta('host', `${hostLabel} (ssh)`, { icon: 'network', color: '#F59E0B' }),
    );

    // Report the actual remote cwd
    if (event.cwd) {
      commands.push(
        cmd.reportMeta('remote_cwd', event.cwd, { icon: 'folder', color: '#6B7280' }),
      );
    }

    // Log SSH info
    if (config.features.logs) {
      commands.push(
        cmd.log(`SSH session: ${hostLabel}`, { level: 'info', source: LOG_SOURCE }),
      );
    }
  } else {
    // Local session — clear any stale SSH metadata from previous session
    commands.push(cmd.clearMeta('host'));
    commands.push(cmd.clearMeta('remote_cwd'));
  }

  // Model metadata removed — wastes sidebar space, already visible in Claude Code UI

  // Send all initialization commands
  try {
    await socket.sendBatch(commands);
  } catch {
    // Non-critical
  }

  // Clean up stale state files from old sessions (background, non-blocking)
  try {
    state.cleanStale(STALE_MAX_AGE_MS);
  } catch {
    // Non-critical
  }
}

/**
 * Handle SessionEnd — clean up state and sidebar.
 */
export async function onSessionEnd(
  event: SessionEndInput,
  socket: CmuxSocket,
  cmd: CmuxCommands,
  state: StateManager,
  config: CcCmuxConfig,
): Promise<void> {
  const commands: string[] = [];

  // Clear sidebar state (matches official cmux cleanup order)
  commands.push(cmd.clearStatus('claude_code'));
  commands.push(cmd.clearAgentPid('claude_code'));
  commands.push(cmd.clearNotifications());
  commands.push(cmd.clearProgress());

  if (config.features.logs) {
    commands.push(cmd.clearLog());
  }

  // Clear metadata
  commands.push(cmd.clearMeta('host'));
  commands.push(cmd.clearMeta('remote_cwd'));

  try {
    await socket.sendBatch(commands);
  } catch {
    // Non-critical
  }

  // Delete state file
  try {
    state.delete();
  } catch {
    // Non-critical
  }

  // Delete tab title file
  try {
    deleteTabTitle(event.session_id);
  } catch {
    // Non-critical
  }
}
