/**
 * Status priority system for the cmux sidebar (cmux-claude-code).
 *
 * Multiple events can try to set status simultaneously (e.g. a tool fires
 * while an agent is starting). The priority system ensures the most important
 * status always wins, while allowing same-priority updates to flow through
 * (e.g. working -> working with a different tool label).
 */

import type { StatusPhase } from '../state/types.js';

/** Numeric priority for each status phase — higher wins */
export const STATUS_PRIORITY: Record<StatusPhase, number> = {
  error: 100,
  waiting: 90,
  compacting: 70,
  working: 50,
  thinking: 40,
  done: 30,
  ready: 10,
};

/** Display configuration for each status phase */
export const STATUS_DISPLAY: Record<StatusPhase, { icon: string; color: string }> = {
  ready:      { icon: 'checkmark.circle',               color: '#50C878' },
  thinking:   { icon: 'brain',                          color: '#FFD700' },
  working:    { icon: 'hammer.fill',                    color: '#4C8DFF' },
  waiting:    { icon: 'hand.raised.fill',               color: '#FF6B35' },
  done:       { icon: 'checkmark.seal',                 color: '#50C878' },
  error:      { icon: 'xmark.circle',                   color: '#FF4444' },
  compacting: { icon: 'arrow.triangle.2.circlepath',    color: '#9B59B6' },
};

/**
 * Resolve which status should be displayed when transitioning from
 * `current` to `next`. Higher priority wins, except that working->working
 * always allows through (so the tool label updates).
 */
export function resolveStatus(current: StatusPhase, next: StatusPhase): StatusPhase {
  // working -> working always updates (different tool labels)
  if (current === 'working' && next === 'working') {
    return next;
  }

  const currentPriority = STATUS_PRIORITY[current] ?? 0;
  const nextPriority = STATUS_PRIORITY[next] ?? 0;

  return nextPriority >= currentPriority ? next : current;
}

/**
 * Format a human-readable status value string for the sidebar pill.
 *
 * Examples:
 *   formatStatusValue('working', 'Edit foo.ts')        -> "Working: Edit foo.ts"
 *   formatStatusValue('working', undefined, 3)          -> "Working (3 agents)"
 *   formatStatusValue('working', 'Bash: npm test', 2)   -> "Working (2 agents): Bash: npm test"
 *   formatStatusValue('done')                           -> "Done"
 *   formatStatusValue('thinking')                       -> "Thinking..."
 */
export function formatStatusValue(
  phase: StatusPhase,
  detail?: string,
  agentCount?: number,
): string {
  const label = phaseLabel(phase);

  const parts: string[] = [label];

  if (agentCount && agentCount > 0) {
    parts[0] = `${label} (${agentCount} agent${agentCount === 1 ? '' : 's'})`;
  }

  if (detail) {
    parts.push(detail);
  }

  return parts.join(': ');
}

function phaseLabel(phase: StatusPhase): string {
  switch (phase) {
    case 'ready':      return 'Ready';
    case 'thinking':   return 'Thinking...';
    case 'working':    return 'Working';
    case 'waiting':    return 'Waiting';
    case 'done':       return 'Done';
    case 'error':      return 'Error';
    case 'compacting': return 'Compacting...';
  }
}
