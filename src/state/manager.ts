import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  renameSync,
  unlinkSync,
  rmdirSync,
  readdirSync,
  statSync,
} from 'node:fs';
import { join } from 'node:path';
import type { SessionState } from './types.js';

const STATE_DIR = '/tmp/cc-cmux';
const LOCK_TIMEOUT_MS = 100;
const LOCK_SPIN_MS = 1;
const STALE_LOCK_MS = 5000;

export class StateManager {
  private readonly sessionId: string;
  private readonly stateFile: string;
  private readonly lockDir: string;

  constructor(sessionId: string) {
    this.sessionId = sessionId;
    this.stateFile = join(STATE_DIR, `${sessionId}.json`);
    this.lockDir = join(STATE_DIR, `${sessionId}.lock`);
  }

  /** Create a default initial state */
  createDefault(): SessionState {
    const now = Date.now();
    return {
      sessionId: this.sessionId,
      workspaceId: '',
      surfaceId: '',
      socketPath: '',
      currentStatus: 'ready',
      toolUseCount: 0,
      turnToolCounts: [],
      activeSubagents: 0,
      totalSubagentsSpawned: 0,
      spawnedPanes: [],
      gitBranch: null,
      gitDirty: false,
      currentTabTitle: null,
      model: null,
      preCompactStatus: null,
      isInTurn: false,
      turnNumber: 0,
      turnStartTime: 0,
      sessionStartTime: now,
      lastUpdateTime: now,
      toolHistory: [],
    };
  }

  /** Read state from disk. Returns defaults if file is missing or corrupt. */
  read(): SessionState {
    try {
      this.ensureDir();
      const raw = readFileSync(this.stateFile, 'utf-8');
      const parsed = JSON.parse(raw) as SessionState;
      return parsed;
    } catch {
      return this.createDefault();
    }
  }

  /** Atomic write: write to temp then rename (POSIX-atomic on same fs). */
  write(state: SessionState): void {
    try {
      this.ensureDir();
      state.lastUpdateTime = Date.now();
      const tmpFile = this.stateFile + '.tmp.' + process.pid;
      writeFileSync(tmpFile, JSON.stringify(state), 'utf-8');
      renameSync(tmpFile, this.stateFile);
    } catch {
      // Swallow — never crash the handler
    }
  }

  /**
   * Acquire lock, read state, apply mutation, write, unlock.
   * The callback receives a mutable state and can optionally return a value.
   */
  withState<T>(fn: (state: SessionState) => T): T {
    this.lock();
    try {
      const state = this.read();
      const result = fn(state);
      this.write(state);
      return result;
    } finally {
      this.unlock();
    }
  }

  /** Remove state file and lock directory */
  delete(): void {
    try {
      unlinkSync(this.stateFile);
    } catch {
      // Ignore
    }
    this.unlock();
  }

  /** Remove state files older than maxAgeMs */
  cleanStale(maxAgeMs: number): void {
    try {
      this.ensureDir();
      const now = Date.now();
      const entries = readdirSync(STATE_DIR);
      for (const entry of entries) {
        if (!entry.endsWith('.json') || entry === 'config.cache.json') continue;
        const filePath = join(STATE_DIR, entry);
        try {
          const stat = statSync(filePath);
          if (now - stat.mtimeMs > maxAgeMs) {
            unlinkSync(filePath);
            // Also clean up any associated lock
            const lockPath = filePath.replace(/\.json$/, '.lock');
            try {
              rmdirSync(lockPath);
            } catch {
              // Ignore
            }
          }
        } catch {
          // Ignore individual file errors
        }
      }
    } catch {
      // Swallow
    }
  }

  // ---- Private helpers ----

  private ensureDir(): void {
    try {
      mkdirSync(STATE_DIR, { recursive: true });
    } catch {
      // Already exists or truly inaccessible — either way, move on
    }
  }

  /** Acquire an advisory lock via mkdir (atomic on POSIX). */
  private lock(): void {
    const deadline = Date.now() + LOCK_TIMEOUT_MS;

    while (true) {
      try {
        this.ensureDir();
        mkdirSync(this.lockDir);
        return; // Acquired
      } catch {
        // Lock exists — check for staleness
        this.breakStaleLock();

        if (Date.now() >= deadline) {
          // Timed out — force-break and proceed
          this.forceUnlock();
          try {
            mkdirSync(this.lockDir);
          } catch {
            // Proceed unlocked rather than crash
          }
          return;
        }

        // Spin-wait
        this.spinWait(LOCK_SPIN_MS);
      }
    }
  }

  /** Release the advisory lock */
  private unlock(): void {
    try {
      rmdirSync(this.lockDir);
    } catch {
      // Ignore — may not exist
    }
  }

  /** Force-remove a lock directory */
  private forceUnlock(): void {
    try {
      rmdirSync(this.lockDir);
    } catch {
      // Ignore
    }
  }

  /** Break the lock if it's older than STALE_LOCK_MS */
  private breakStaleLock(): void {
    try {
      const stat = statSync(this.lockDir);
      if (Date.now() - stat.mtimeMs > STALE_LOCK_MS) {
        rmdirSync(this.lockDir);
      }
    } catch {
      // Lock dir doesn't exist or can't be stated — either way, proceed
    }
  }

  /** Synchronous spin-wait for the given milliseconds */
  private spinWait(ms: number): void {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      // busy-wait
    }
  }
}
