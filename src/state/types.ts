export type StatusPhase =
  | 'ready'
  | 'thinking'
  | 'working'
  | 'waiting'
  | 'done'
  | 'error'
  | 'compacting';

export interface ToolHistoryEntry {
  toolName: string;
  summary: string;
  timestamp: number;
}

export interface SpawnedPane {
  surfaceRef: string;
  agentType: string;
  prompt: string;
  startTime: number;
}

export interface SessionState {
  sessionId: string;
  workspaceId: string;
  surfaceId: string;
  socketPath: string;
  currentStatus: StatusPhase;
  toolUseCount: number;
  /** History of tool counts per turn (last 5) */
  turnToolCounts: number[];
  activeSubagents: number;
  totalSubagentsSpawned: number;
  /** Visible agent panes */
  spawnedPanes: SpawnedPane[];
  gitBranch: string | null;
  gitDirty: boolean;
  currentTabTitle: string | null;
  model: string | null;
  /** Status saved before compaction, restored in PostCompact */
  preCompactStatus: string | null;
  isInTurn: boolean;
  turnNumber: number;
  turnStartTime: number;
  sessionStartTime: number;
  lastUpdateTime: number;
  toolHistory: ToolHistoryEntry[];
}
