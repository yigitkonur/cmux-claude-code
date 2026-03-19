/**
 * Notification and permission request handlers.
 *
 * Notification: Forward Claude Code notifications to cmux desktop notifications.
 * PermissionRequest: Update status to "Waiting" and optionally notify.
 */

import type { CmuxSocket } from '../cmux/socket.js';
import type { CmuxCommands } from '../cmux/commands.js';
import type { StateManager } from '../state/manager.js';
import type { CcCmuxConfig } from '../config/types.js';
import type { CmuxEnv } from '../util/env.js';
import type { NotificationInput, PermissionRequestInput } from './types.js';
import { STATUS_DISPLAY, formatStatusValue } from '../features/status.js';
import { LOG_SOURCE } from '../features/logger.js';

/**
 * Handle Notification — forward to cmux desktop notification.
 * Uses notifyTarget for workspace-specific delivery (like official cmux hooks).
 *
 * IMPORTANT: This handler NEVER changes the sidebar status pill.
 * Only PermissionRequest should set "Waiting" / "Needs input" status.
 * Notifications fire for many reasons (subagent completions, informational
 * messages) and keyword-matching them caused false "Needs input" stalls.
 */
export async function onNotification(
  event: NotificationInput,
  socket: CmuxSocket,
  cmd: CmuxCommands,
  config: CcCmuxConfig,
  env: CmuxEnv,
): Promise<void> {
  if (!config.features.notifications) return;

  const title = event.title ?? 'Claude Code';
  const message = event.message ?? '';

  try {
    socket.fire(cmd.notifyTarget(env.workspaceId, env.surfaceId, title, '', message));
  } catch {
    // Non-critical
  }
}

/**
 * Handle PermissionRequest — set status to "Waiting" and optionally
 * send a desktop notification to alert the user.
 */
export async function onPermissionRequest(
  event: PermissionRequestInput,
  socket: CmuxSocket,
  cmd: CmuxCommands,
  state: StateManager,
  config: CcCmuxConfig,
  env: CmuxEnv,
): Promise<void> {
  const toolName = event.tool_name ?? 'unknown';

  // Update state
  state.withState((s) => {
    s.currentStatus = 'waiting';
  });

  // Set status to Waiting
  if (config.features.statusPills) {
    const display = STATUS_DISPLAY.waiting;
    try {
      socket.fire(
        cmd.setStatus('claude_code', formatStatusValue('waiting', toolName), {
          icon: display.icon,
          color: display.color,
        }),
      );
    } catch {
      // Non-critical
    }
  }

  // Log permission request
  if (config.features.logs) {
    try {
      socket.fire(
        cmd.log(`Permission requested: ${toolName}`, {
          level: 'warning',
          source: LOG_SOURCE,
        }),
      );
    } catch {
      // Non-critical
    }
  }

  // Send targeted desktop notification if configured
  if (config.features.notifications && config.notifications.onPermission) {
    try {
      socket.fire(
        cmd.notifyTarget(env.workspaceId, env.surfaceId, 'Claude Code', 'Permission Required', `Tool: ${toolName}`),
      );
    } catch {
      // Non-critical
    }
  }
}
