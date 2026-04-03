/**
 * cc-cmux main handler — the single entry point invoked by Claude Code hooks.
 *
 * Reads a JSON event from stdin, identifies the hook event type, and dispatches
 * to the appropriate handler. All paths are wrapped in try/catch and the process
 * always exits 0 — this handler is cosmetic and must NEVER block Claude Code.
 *
 * Built as a CJS bundle (handler.cjs) via tsup.
 */

import { isCmuxAvailable, getCmuxEnv } from './util/env.js';
import { readStdin } from './util/stdin.js';
import { loadConfig } from './config/loader.js';
import { CmuxSocket } from './cmux/socket.js';
import { CmuxCommands } from './cmux/commands.js';
import { StateManager } from './state/manager.js';

import type { AnyHookEventInput } from './events/types.js';
import type { HandlerContext } from './events/context.js';

// Event handlers
import { onSessionStart, onSessionEnd } from './events/session.js';
import { onPreToolUse, onPostToolUse, onPostToolUseFailure } from './events/tools.js';
import { onUserPromptSubmit, onStop, onStopFailure } from './events/flow.js';
import { onSubagentStart, onSubagentStop } from './events/agents.js';
import { onPreCompact, onPostCompact, onTaskCompleted, onWorktreeCreate } from './events/lifecycle.js';
import { onNotification, onPermissionRequest } from './events/notifications.js';

/** Parse stdin JSON into a typed event, returning null on any failure. */
function parseEvent(raw: string): AnyHookEventInput | null {
  try {
    const obj = JSON.parse(raw);
    return obj?.hook_event_name ? (obj as AnyHookEventInput) : null;
  } catch {
    return null;
  }
}

async function main(): Promise<void> {
  // Guard: no-op if not running inside cmux
  if (!isCmuxAvailable()) {
    process.exit(0);
  }

  // Read the event JSON from stdin
  const raw = await readStdin(500);
  if (!raw) {
    process.exit(0);
  }

  // Parse outside try/catch so TypeScript can narrow through the switch
  const event = parseEvent(raw);
  if (!event) {
    process.exit(0);
  }

  // Load config (cached after first call)
  const config = loadConfig();
  const env = getCmuxEnv();
  const cmuxBin = process.env['CMUX_BIN'] ?? 'cmux';
  const socket = new CmuxSocket(env.socketPath, cmuxBin);
  const cmd = new CmuxCommands(env.workspaceId);
  const state = new StateManager(event.session_id);
  const ctx: HandlerContext = { socket, cmd, state, config, env };

  // Dispatch — TypeScript narrows `event` via discriminated union on hook_event_name
  try {
    switch (event.hook_event_name) {
      case 'SessionStart':
        await onSessionStart(event, ctx);
        break;

      case 'UserPromptSubmit':
        await onUserPromptSubmit(event, ctx);
        break;

      case 'PreToolUse':
        await onPreToolUse(event, ctx);
        break;

      case 'PostToolUse':
        await onPostToolUse(event, ctx);
        break;

      case 'PostToolUseFailure':
        await onPostToolUseFailure(event, ctx);
        break;

      case 'PermissionRequest':
        await onPermissionRequest(event, ctx);
        break;

      case 'Stop':
        await onStop(event, ctx);
        break;

      case 'StopFailure':
        await onStopFailure(event, ctx);
        break;

      case 'SubagentStart':
        await onSubagentStart(event, ctx);
        break;

      case 'SubagentStop':
        await onSubagentStop(event, ctx);
        break;

      case 'Notification':
        await onNotification(event, ctx);
        break;

      case 'SessionEnd':
        await onSessionEnd(event, ctx);
        break;

      case 'TaskCompleted':
        await onTaskCompleted(event, ctx);
        break;

      case 'PreCompact':
        await onPreCompact(event, ctx);
        break;

      case 'PostCompact':
        await onPostCompact(event, ctx);
        break;

      case 'WorktreeCreate':
        await onWorktreeCreate(event, ctx);
        break;

      default:
        // Unknown event — silently ignore
        break;
    }
  } catch {
    // Swallow all errors — this handler must never crash Claude Code
  }

  // Give fire-and-forget socket connections time to flush before exiting.
  // Without this, process.exit(0) kills pending socket writes.
  await new Promise<void>((resolve) => setTimeout(resolve, 50));
  process.exit(0);
}

// Global safety net
process.on('uncaughtException', () => process.exit(0));
process.on('unhandledRejection', () => process.exit(0));

// Run
main().catch(() => {
  process.exit(0);
});
