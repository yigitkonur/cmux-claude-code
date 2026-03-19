/**
 * Subagent lifecycle handlers: SubagentStart and SubagentStop.
 *
 * These track the number of active subagents and update the sidebar
 * status to reflect agent activity.
 */

import type { CmuxSocket } from '../cmux/socket.js';
import type { CmuxCommands } from '../cmux/commands.js';
import type { StateManager } from '../state/manager.js';
import type { CcCmuxConfig } from '../config/types.js';
import type { SubagentStartInput, SubagentStopInput } from './types.js';
import { STATUS_DISPLAY, formatStatusValue } from '../features/status.js';
import { LOG_SOURCE } from '../features/logger.js';

/**
 * Handle SubagentStart — increment agent count and update sidebar.
 */
export async function onSubagentStart(
  event: SubagentStartInput,
  socket: CmuxSocket,
  cmd: CmuxCommands,
  state: StateManager,
  config: CcCmuxConfig,
): Promise<void> {
  if (!config.features.subagentTracking) return;

  const agentType = event.agent_type ?? 'agent';

  state.withState((s) => {
    s.activeSubagents++;
    s.totalSubagentsSpawned++;
  });

  // Log the agent spawn
  if (config.features.logs) {
    try {
      socket.fire(
        cmd.log(`Agent spawned: ${agentType}`, {
          level: 'info',
          source: 'claude',
        }),
      );
    } catch {
      // Non-critical
    }
  }

  // Update status with agent count if currently working
  if (config.features.statusPills) {
    const s = state.read();
    if (s.currentStatus === 'working') {
      const display = STATUS_DISPLAY.working;
      try {
        socket.fire(
          cmd.setStatus(
            'claude_code',
            formatStatusValue('working', undefined, s.activeSubagents),
            { icon: display.icon, color: display.color },
          ),
        );
      } catch {
        // Non-critical
      }
    }
  }
}

/**
 * Handle SubagentStop — decrement agent count and log completion.
 */
export async function onSubagentStop(
  event: SubagentStopInput,
  socket: CmuxSocket,
  cmd: CmuxCommands,
  state: StateManager,
  config: CcCmuxConfig,
): Promise<void> {
  if (!config.features.subagentTracking) return;

  const agentType = event.agent_type ?? 'agent';

  state.withState((s) => {
    s.activeSubagents = Math.max(0, s.activeSubagents - 1);
  });

  // Log agent completion (info level, not success — avoids confusion with main "Done")
  if (config.features.logs) {
    try {
      socket.fire(
        cmd.log(`Subagent done: ${agentType}`, {
          level: 'info',
          source: 'claude',
        }),
      );
    } catch {
      // Non-critical
    }
  }
}
