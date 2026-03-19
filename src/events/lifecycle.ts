/**
 * Miscellaneous lifecycle handlers: PreCompact, PostCompact, TaskCompleted, WorktreeCreate.
 *
 * These are lightweight event handlers that primarily log sidebar entries
 * and update status during context compaction.
 */

import type { CmuxSocket } from '../cmux/socket.js';
import type { CmuxCommands } from '../cmux/commands.js';
import type { StateManager } from '../state/manager.js';
import type { CcCmuxConfig } from '../config/types.js';
import { STATUS_DISPLAY, formatStatusValue } from '../features/status.js';
import { LOG_SOURCE } from '../features/logger.js';

/**
 * Handle PreCompact — log compaction start, save current status, set "compacting".
 */
export async function onPreCompact(
  socket: CmuxSocket,
  cmd: CmuxCommands,
  state: StateManager,
  config: CcCmuxConfig,
): Promise<void> {
  if (config.features.logs) {
    try {
      socket.fire(
        cmd.log('Compacting context...', {
          level: 'progress',
          source: LOG_SOURCE,
        }),
      );
    } catch {
      // Non-critical
    }
  }

  // Save current status before overwriting with 'compacting'
  state.withState((s) => {
    s.preCompactStatus = s.currentStatus;
  });

  if (config.features.statusPills) {
    const display = STATUS_DISPLAY.compacting;
    try {
      socket.fire(
        cmd.setStatus('claude_code', formatStatusValue('compacting'), {
          icon: display.icon,
          color: display.color,
        }),
      );
    } catch {
      // Non-critical
    }
  }
}

/**
 * Handle PostCompact — log compaction complete, restore previous status.
 *
 * Previously always reverted to 'working', which overwrote 'done' (priority 30)
 * when compaction happened between turns or from subagent activity.
 */
export async function onPostCompact(
  socket: CmuxSocket,
  cmd: CmuxCommands,
  state: StateManager,
  config: CcCmuxConfig,
): Promise<void> {
  if (config.features.logs) {
    try {
      socket.fire(
        cmd.log('Context compacted', {
          level: 'success',
          source: LOG_SOURCE,
        }),
      );
    } catch {
      // Non-critical
    }
  }

  // Restore the status that was active before compaction
  const s = state.read();
  const restoreTo = s.preCompactStatus || (s.isInTurn ? 'working' : 'done');

  // Clear saved pre-compact status
  state.withState((st) => {
    st.preCompactStatus = null;
    st.currentStatus = restoreTo as any;
  });

  if (config.features.statusPills) {
    const display = STATUS_DISPLAY[restoreTo as keyof typeof STATUS_DISPLAY] || STATUS_DISPLAY.working;
    try {
      socket.fire(
        cmd.setStatus('claude_code', formatStatusValue(restoreTo as any), {
          icon: display.icon,
          color: display.color,
        }),
      );
    } catch {
      // Non-critical
    }
  }
}

/**
 * Handle TaskCompleted — log subagent task completion.
 * This fires when a subagent task completes, NOT when the main session finishes.
 * Uses 'info' level (not 'success') to avoid confusion with main session "Done".
 */
export async function onTaskCompleted(
  event: { session_id: string; [key: string]: unknown },
  socket: CmuxSocket,
  cmd: CmuxCommands,
  config: CcCmuxConfig,
): Promise<void> {
  if (!config.features.logs) return;

  try {
    socket.fire(
      cmd.log('Subagent task completed', {
        level: 'info',
        source: LOG_SOURCE,
      }),
    );
  } catch {
    // Non-critical
  }
}

/**
 * Handle WorktreeCreate — log worktree creation.
 */
export async function onWorktreeCreate(
  event: { session_id: string; path?: string; branch?: string; [key: string]: unknown },
  socket: CmuxSocket,
  cmd: CmuxCommands,
  config: CcCmuxConfig,
): Promise<void> {
  if (!config.features.logs) return;

  try {
    socket.fire(
      cmd.log('Worktree created', {
        level: 'info',
        source: LOG_SOURCE,
      }),
    );
  } catch {
    // Non-critical
  }
}
