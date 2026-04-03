# cmux-claude-pro

the definitive claude code + cmux integration. real-time status pills, progress bars, sidebar logs, desktop notifications, git integration, subagent tracking — all wired up through 16 claude code hooks and cmux's unix socket.

built by studying how [cmux's core team](https://github.com/manaflow-ai/cmux) does their official claude integration, then going way further.

![status](https://img.shields.io/badge/status-production--ready-brightgreen) ![hooks](https://img.shields.io/badge/hooks-16%20events-blue) ![latency](https://img.shields.io/badge/socket%20latency-~8ms-yellow) ![node](https://img.shields.io/badge/node-20%2B-green) ![license](https://img.shields.io/badge/license-MIT-lightgrey)

## demo

<!-- TODO: replace with actual video -->
https://github.com/user-attachments/assets/placeholder-demo-video

> paste the [test prompt](#try-it-yourself) into a fresh claude code session and watch the sidebar light up.

## the sidebar, explained

here's every state you'll see while claude works:

### status pill (top of sidebar)

| state | icon | color | when it appears |
|---|---|---|---|
| `Ready` | checkmark.circle | green | session started, waiting for input |
| `Thinking...` | brain | gold | you submitted a prompt, claude is processing |
| `Working: Read: handler.ts` | hammer.fill | blue | claude is reading a file |
| `Working: Edit: config.ts` | hammer.fill | blue | claude is editing a file |
| `Working: Bash: npm test` | hammer.fill | blue | claude is running a command |
| `Working: Grep: "TODO"` | hammer.fill | blue | claude is searching code |
| `Working: Glob: **/*.ts` | hammer.fill | blue | claude is finding files |
| `Working (2 agents): ...` | hammer.fill | blue | subagents are active |
| `Waiting: Bash` | hand.raised.fill | orange | permission requested |
| `Needs input` | bell.fill | blue | claude sent a notification |
| `Done` | checkmark.seal | green | response complete |
| `Error` | xmark.circle | red | response failed |
| `Compacting...` | arrow.triangle.2.circlepath | purple | context window being compacted |

### progress bar

adaptive estimation using `n/(n+K)` where K learns from your session history:

```
1 tool  → ████░░░░░░░░░░░░░░░░  0.09
3 tools → ██████████░░░░░░░░░░  0.23
5 tools → ████████████░░░░░░░░  0.33
8 tools → ██████████████░░░░░░  0.44
done    → ████████████████████  1.00 Complete
```

never hits 100% until claude actually finishes. caps at 0.95 during work.

### sidebar log entries

every tool use gets a formatted log entry:

```
[claude] [info]    Read: src/handler.ts
[claude] [info]    Edit: features/status.ts
[claude] [info]    Bash: `npm test -- --coverage`
[claude] [info]    Grep: "setStatus" → 10 matches
[claude] [info]    Glob: **/*.ts → 5 files
[claude] [info]    Agent spawned: Explore
[claude] [success] Agent done: Explore
[claude] [success] Task completed
[claude] [warning] FAIL Read: nonexistent-file.ts
[claude] [progress] Compacting context...
[claude] [success] Context compacted
```

### desktop notifications

targeted to the correct workspace tab via `notify_target`:

| trigger | notification |
|---|---|
| claude finishes | "Claude Code / Done / Fixed the auth bug by..." |
| error occurs | "Claude Code / Error / Response failed" |
| permission needed | "Claude Code / Permission Required / Tool: Bash" |

### metadata

| element | source |
|---|---|
| model name | `claude-opus-4-6` via `report_meta` |
| git branch | `main` via `report_git_branch` (+ dirty indicator) |
| working directory | shown by cmux natively |

## all 16 hook events

every claude code lifecycle event we handle:

| hook event | what fires it | what we do |
|---|---|---|
| `SessionStart` | session begins | set Ready, register PID, detect git, report model, clear stale state |
| `SessionEnd` | session exits | clear all sidebar state, delete state file |
| `UserPromptSubmit` | you hit enter | set Thinking, clear progress, clear notifications |
| `PreToolUse` | before any tool runs | set Working with tool name, increment progress bar |
| `PostToolUse` | after tool succeeds | log tool result to sidebar, update tool history |
| `PostToolUseFailure` | after tool fails | log warning with error details |
| `PermissionRequest` | claude needs approval | set Waiting, send desktop notification |
| `Stop` | claude finishes responding | set Done, complete progress, send notification |
| `StopFailure` | API error | set Error, send error notification |
| `SubagentStart` | agent spawned | log spawn, show agent count in status |
| `SubagentStop` | agent finishes | log completion, decrement count |
| `Notification` | claude sends notification | forward to desktop, set Needs Input |
| `PreCompact` | context compaction starts | log "Compacting...", set Compacting status |
| `PostCompact` | compaction finishes | log "Compacted", revert to Working |
| `TaskCompleted` | task marked done | log success |
| `WorktreeCreate` | git worktree created | log worktree info |

## vs the built-in integration

cmux ships with its own claude code integration (via a wrapper script at `Resources/bin/claude` that injects `--settings` with 6 hooks). cmux-claude-pro replaces it completely with 16 hooks and way more features.

### event-by-event comparison

the built-in integration handles 6 hook events. we handle all 6 plus 10 more:

| hook event | cmux built-in | cmux-claude-pro | what we add |
|---|---|---|---|
| `SessionStart` | sets agent PID via `set_agent_pid` | sets PID + Ready status + git branch + model metadata + clear stale state | git, model, richer init |
| `SessionEnd` | clears status + PID + notifications | clears status + PID + notifications + progress + logs + metadata + state files | full cleanup |
| `UserPromptSubmit` | clears notifications, sets "Running" | clears notifications, sets "Thinking...", resets progress bar | distinct thinking state |
| `PreToolUse` | clears notifications, sets "Running" (async) | sets "Working: Edit: foo.ts" with tool name, increments progress | tool-specific status |
| `Stop` | sets "Idle", sends `notify_target` | sets "Done", completes progress to 100%, sends `notify_target` with message preview | done vs idle, progress |
| `Notification` | classifies + forwards via `notify_target`, sets "Needs input" | forwards via `notify_target`, sets "Needs input" | same |
| `PostToolUse` | — | logs every tool result to sidebar (`Read: foo.ts`, `Bash: \`npm test\``) | **new** |
| `PostToolUseFailure` | — | logs failures with warning level | **new** |
| `PermissionRequest` | — | sets "Waiting" status, sends notification | **new** |
| `StopFailure` | — | sets "Error" status, sends error notification | **new** |
| `SubagentStart` | — | logs agent spawn, shows count in status | **new** |
| `SubagentStop` | — | logs agent completion | **new** |
| `PreCompact` | — | sets "Compacting..." status, logs start | **new** |
| `PostCompact` | — | logs completion, reverts status | **new** |
| `TaskCompleted` | — | logs task completion | **new** |
| `WorktreeCreate` | — | logs worktree creation | **new** |

### feature comparison

| feature | cmux built-in | cmux-claude-pro |
|---|---|---|
| hook events | 6 | **16** |
| status states | 3 (Running, Idle, Needs input) | **7** (Ready, Thinking, Working, Waiting, Done, Error, Compacting) |
| tool names in status | opt-in via hidden UserDefault | always on — "Working: Edit: foo.ts" |
| progress bar | no | **yes** — adaptive `n/(n+K)` algorithm |
| sidebar activity logs | no | **yes** — per-tool formatted entries |
| git branch in sidebar | no | **yes** — branch + dirty state |
| model metadata | no | **yes** — shows active model |
| subagent tracking | no | **yes** — count + spawn/done logs |
| task completion | no | **yes** |
| compaction visibility | no | **yes** |
| error state | no (stays "Running" on error) | **yes** — distinct "Error" state |
| crash recovery | yes (`set_agent_pid`) | yes (same mechanism) |
| targeted notifications | yes (`notify_target`) | yes (same mechanism) |
| notification cleanup | yes (`clear_notifications`) | yes (same mechanism) |
| message preview in notif | reads transcript JSONL | reads `last_assistant_message` from hook payload |
| transport | CLI binary (~30ms) | **unix socket (~8ms)** |
| hook injection | wraps `claude` binary via PATH | registers in `settings.json` directly |
| configuration | none | **per-feature toggles** in config.json |

### cmux primitives comparison

| socket command | cmux built-in | cmux-claude-pro |
|---|---|---|
| `set_status` | yes — key: `claude_code` | yes — same key |
| `clear_status` | yes | yes |
| `set_agent_pid` | yes | yes |
| `clear_agent_pid` | yes | yes |
| `notify_target` | yes | yes |
| `clear_notifications` | yes | yes |
| `set_progress` | — | **yes** |
| `clear_progress` | — | **yes** |
| `log` | — | **yes** |
| `clear_log` | — | **yes** |
| `report_git_branch` | — | **yes** |
| `report_meta` | — | **yes** |

## install

### one-liner

```bash
rm -rf /tmp/cmux-claude-pro && cd /tmp && git clone https://github.com/yigitkonur/cmux-claude-pro.git && cd cmux-claude-pro && npm install && npm run build && bash install.sh
```

the installer automatically:
- copies handler files to `~/.cc-cmux/`
- **disables cmux's built-in claude integration** (via `defaults write`)
- merges 16 hooks into your `~/.claude/settings.json` (preserving existing hooks)
- creates a backup at `settings.json.cc-cmux-backup`
- verifies the handler loads correctly

### step by step

```bash
# 1. clone
git clone https://github.com/yigitkonur/cmux-claude-pro.git
cd cmux-claude-pro

# 2. build (needs node 20+)
npm install
npm run build

# 3. install — disables built-in integration, merges hooks, copies handler
bash install.sh

# 4. restart claude code
```

### what the installer does with cmux's built-in integration

cmux-claude-pro takes over the `claude_code` status key. the installer automatically runs:

```bash
defaults write com.cmuxterm.app claudeCodeHooksEnabled -bool false
```

this disables cmux's wrapper script that normally injects its own hooks via `--settings`. if you ever want to go back:

```bash
defaults write com.cmuxterm.app claudeCodeHooksEnabled -bool true
```

## hook configuration

the installer handles this automatically. if you prefer manual setup, add these hooks to your `~/.claude/settings.json` inside the `"hooks"` key. existing hooks are preserved — cc-cmux entries are appended alongside your own.

```json
{
  "hooks": {
    "SessionStart": [{"description": "cc-cmux: initialize sidebar, detect git, report model", "hooks": [{"type": "command", "command": "node ~/.cc-cmux/handler.cjs", "timeout": 10}]}],
    "SessionEnd": [{"description": "cc-cmux: clean up sidebar state", "hooks": [{"type": "command", "command": "node ~/.cc-cmux/handler.cjs", "timeout": 5}]}],
    "UserPromptSubmit": [{"description": "cc-cmux: set thinking status, reset progress", "hooks": [{"type": "command", "command": "node ~/.cc-cmux/handler.cjs", "timeout": 10}]}],
    "PreToolUse": [{"description": "cc-cmux: update status and progress bar", "hooks": [{"type": "command", "command": "node ~/.cc-cmux/handler.cjs", "timeout": 10}]}],
    "PostToolUse": [{"description": "cc-cmux: log tool results to sidebar", "hooks": [{"type": "command", "command": "node ~/.cc-cmux/handler.cjs", "timeout": 10}]}],
    "PostToolUseFailure": [{"description": "cc-cmux: log tool errors to sidebar", "hooks": [{"type": "command", "command": "node ~/.cc-cmux/handler.cjs", "timeout": 10}]}],
    "PermissionRequest": [{"description": "cc-cmux: set waiting status, notify on permission", "hooks": [{"type": "command", "command": "node ~/.cc-cmux/handler.cjs", "timeout": 10}]}],
    "Stop": [{"description": "cc-cmux: set done status, complete progress, notify", "hooks": [{"type": "command", "command": "node ~/.cc-cmux/handler.cjs", "timeout": 10}]}],
    "StopFailure": [{"description": "cc-cmux: set error status, notify on failure", "hooks": [{"type": "command", "command": "node ~/.cc-cmux/handler.cjs", "timeout": 10}]}],
    "Notification": [{"description": "cc-cmux: forward notifications to desktop", "hooks": [{"type": "command", "command": "node ~/.cc-cmux/handler.cjs", "timeout": 10}]}],
    "SubagentStart": [{"description": "cc-cmux: track agent spawn in sidebar", "hooks": [{"type": "command", "command": "node ~/.cc-cmux/handler.cjs", "timeout": 10}]}],
    "SubagentStop": [{"description": "cc-cmux: track agent completion in sidebar", "hooks": [{"type": "command", "command": "node ~/.cc-cmux/handler.cjs", "timeout": 10}]}],
    "PreCompact": [{"description": "cc-cmux: log compaction start", "hooks": [{"type": "command", "command": "node ~/.cc-cmux/handler.cjs", "timeout": 10}]}],
    "PostCompact": [{"description": "cc-cmux: log compaction complete", "hooks": [{"type": "command", "command": "node ~/.cc-cmux/handler.cjs", "timeout": 10}]}],
    "TaskCompleted": [{"description": "cc-cmux: log task completion", "hooks": [{"type": "command", "command": "node ~/.cc-cmux/handler.cjs", "timeout": 10}]}],
    "WorktreeCreate": [{"description": "cc-cmux: log worktree creation", "hooks": [{"type": "command", "command": "node ~/.cc-cmux/handler.cjs", "timeout": 10}]}]
  }
}
```

restart claude code after adding hooks.

## try it yourself

paste this into a fresh claude code session. works in any directory — even an empty folder. creates temp files, exercises every hook, then offers to clean up after itself.

```
run this test script step by step. wait 2 seconds between each step so i can
watch the cmux sidebar update. announce each step number before executing it.

step 1 — WRITE (creates a test file)
create a file /tmp/cmux-test-alpha.txt with this content:
"hello from cmux-claude-pro
this file tests the sidebar integration
TODO: verify grep finds this line
export const status = 'working';"

step 2 — WRITE (creates a second test file)
create a file /tmp/cmux-test-beta.txt with this content:
"second test file for cmux-claude-pro
export function demo() { return true; }
TODO: clean up after test"

step 3 — READ (reads back the first file)
read the file /tmp/cmux-test-alpha.txt

step 4 — GREP (searches across both files)
search for the pattern "TODO" in /tmp/cmux-test-alpha.txt and /tmp/cmux-test-beta.txt

step 5 — GLOB (finds the test files)
find all files matching /tmp/cmux-test-*.txt

step 6 — EDIT (modifies the first file)
in /tmp/cmux-test-alpha.txt, replace "TODO: verify grep finds this line" with "DONE: grep found this line"

step 7 — BASH (runs a command)
run: cat /tmp/cmux-test-alpha.txt | wc -l

step 8 — BASH (another command)
run: echo "cmux-claude-pro sidebar test — all tools working"

step 9 — READ FAILURE (triggers warning log)
try to read /tmp/cmux-test-this-does-not-exist.txt

step 10 — TASK (creates and completes a task)
create a task called "cmux sidebar verification" and immediately mark it as completed

step 11 — SUBAGENT (spawns an explore agent)
use an Explore agent to count how many lines are in /tmp/cmux-test-alpha.txt

step 12 — MULTI-TOOL (parallel reads)
read these 2 files in parallel:
- /tmp/cmux-test-alpha.txt
- /tmp/cmux-test-beta.txt

step 13 — CLEANUP OFFER
list all files that were created during this test:
- /tmp/cmux-test-alpha.txt
- /tmp/cmux-test-beta.txt
ask me: "test complete — all cmux-claude-pro sidebar features verified! want me to delete the test files?"
if i say yes, delete them. if i say no, leave them.
```

### what you'll see

| step | status pill | progress | sidebar log | notification |
|---|---|---|---|---|
| start | `Ready` (green) | — | — | — |
| prompt | `Thinking...` (gold) | cleared | — | — |
| 1 | `Working: Write: cmux-test-alpha.txt` | `0.09 1 tool` | `Write: cmux-test-alpha.txt` | — |
| 2 | `Working: Write: cmux-test-beta.txt` | `0.17 2 tools` | `Write: cmux-test-beta.txt` | — |
| 3 | `Working: Read: cmux-test-alpha.txt` | `0.23 3 tools` | `Read: cmux-test-alpha.txt` | — |
| 4 | `Working: Grep: "TODO"` | `0.29 4 tools` | `Grep: "TODO" → 2 matches` | — |
| 5 | `Working: Glob: cmux-test-*` | `0.33 5 tools` | `Glob: cmux-test-*.txt` | — |
| 6 | `Working: Edit: cmux-test-alpha.txt` | `0.38 6 tools` | `Edit: cmux-test-alpha.txt` | — |
| 7 | `Working: Bash: cat /tmp/cmux...` | `0.41 7 tools` | `Bash: \`cat /tmp/cmux...\`` | — |
| 8 | `Working: Bash: echo "cmux...` | `0.44 8 tools` | `Bash: \`echo "cmux-claude...\`` | — |
| 9 | — | `0.47 9 tools` | `⚠ FAIL Read: cmux-test-this...` | — |
| 10 | `Working: TaskCreate` | `0.50 10-11 tools` | `TaskCreate` + `Task completed` | — |
| 11 | `Working (1 agent): ...` | `0.55 12 tools` | `Agent spawned` → `Agent done` | — |
| 12 | `Working: Read: ...` | `0.58 14 tools` | 2x `Read: ...` entries | — |
| 13 | `Done` (green) | `1.00 Complete` | — | "Done — test complete..." |

## configuration

`~/.cc-cmux/config.json` — all features individually toggleable:

```json
{
  "features": {
    "statusPills": true,
    "progress": true,
    "logs": true,
    "notifications": true,
    "tabTitles": false,
    "gitIntegration": true,
    "subagentTracking": true,
    "visibleAgentPanes": false
  },
  "notifications": {
    "onStop": true,
    "onError": true,
    "onPermission": true
  },
  "tabTitle": {
    "style": "directory"
  }
}
```

## ssh / et / remote machines

when you ssh (or et) into a remote machine and run claude code there, cmux-claude-pro can update **your local sidebar** with the remote session's status, including the remote hostname and cwd.

### how it works

the cmux unix socket gets forwarded to the remote machine via SSH's `-R` flag. the handler on the remote detects `SSH_CONNECTION`, grabs the hostname, and talks to your local cmux through the forwarded socket.

```
local cmux sidebar ← unix socket ← SSH -R tunnel ← remote handler ← claude code hooks
```

when SSH isn't detected, the handler shows local info as usual.

### setup (one-time per remote host)

**step 1 — local machine:** create a symlink (cmux socket path has spaces that break SSH -R):

```bash
# add to your ~/.zshrc or ~/.bashrc
if [ -S "$CMUX_SOCKET_PATH" ]; then
  ln -sf "$CMUX_SOCKET_PATH" /tmp/cmux-local.sock 2>/dev/null
fi
```

**step 2 — local machine:** add socket forwarding + env forwarding to `~/.ssh/config`:

```
Host myserver
  RemoteForward /tmp/cmux-fwd.sock /tmp/cmux-local.sock
  SendEnv CMUX_WORKSPACE_ID CMUX_SURFACE_ID CMUX_TAB_ID CMUX_PANEL_ID
```

`SendEnv` forwards the correct cmux identity vars from each tab's environment directly through SSH — no shared env file that goes stale.

**step 3 — remote machine:** run the setup script (handles sshd config + shell profile):

```bash
scp remote-setup.sh myserver: && ssh myserver bash remote-setup.sh
```

or manually:

```bash
# accept cmux env vars from SSH + allow socket reuse
echo "AcceptEnv CMUX_WORKSPACE_ID CMUX_SURFACE_ID CMUX_TAB_ID CMUX_PANEL_ID" | sudo tee -a /etc/ssh/sshd_config
echo "StreamLocalBindUnlink yes" | sudo tee -a /etc/ssh/sshd_config
# macOS:
sudo launchctl kickstart -k system/com.openssh.sshd
# Linux:
sudo systemctl restart sshd
```

**step 4 — remote machine:** deploy handler + add socket detection:

```bash
# copy handler files from local
scp ~/.cc-cmux/handler.cjs myserver:~/.cc-cmux/

# or run the remote setup script (also handles step 3)
scp remote-setup.sh myserver: && ssh myserver bash remote-setup.sh
```

add to the remote machine's `~/.zshrc` or `~/.bashrc` (the setup script does this automatically):

```bash
# cmux-claude-pro: detect forwarded cmux socket
# SSH SendEnv/AcceptEnv provides correct per-connection workspace/surface IDs.
# Env file is fallback only (for ET/mosh where SendEnv is unavailable).
if [ -S /tmp/cmux-fwd.sock ] && [ -n "$SSH_CONNECTION" ]; then
  export CMUX_SOCKET_PATH=/tmp/cmux-fwd.sock
  if [ -z "$CMUX_WORKSPACE_ID" ] && [ -f /tmp/cmux-fwd.env ]; then
    . /tmp/cmux-fwd.env
  fi
fi
```

### what the sidebar shows for SSH sessions

```
host: user@macmini (ssh)              ← yellow network icon
remote_cwd: /home/user/dev/project   ← gray folder icon
model: opus-4.6                      ← purple cpu icon
claude_code: Working: Bash: npm test ← blue hammer
[claude] [info] SSH session: user@macmini
```

### for ET (eternal terminal)

ET doesn't support `SendEnv` or socket forwarding. run a background SSH tunnel alongside it and write an env file with the current tab's IDs:

```bash
# write workspace/surface IDs for this tab, then start socket tunnel + ET
printf 'export CMUX_WORKSPACE_ID=%s\nexport CMUX_SURFACE_ID=%s\n' \
  "$CMUX_WORKSPACE_ID" "$CMUX_SURFACE_ID" | ssh myserver 'cat > /tmp/cmux-fwd.env'
ssh -N -f -R /tmp/cmux-fwd.sock:/tmp/cmux-local.sock myserver
et myserver
```

the handler reads the env file as fallback when `SendEnv`/`AcceptEnv` isn't available.

## how it works

a single 45KB node.js handler (`handler.cjs`) gets invoked for every hook event. reads JSON from stdin, updates cmux's sidebar via direct unix socket (~8ms per call), manages state atomically in `/tmp/cc-cmux/`.

no daemon. no background process. no runtime dependencies. just node builtins.

```
claude code hook event
    → stdin JSON
    → handler.cjs (route by hook_event_name)
    → unix socket → cmux sidebar
    → atomic state file write
    → exit 0 (always)
```

## cmux primitives used

same socket protocol as the official integration, plus 6 extras:

| primitive | official cmux | cmux-claude-pro | what it does |
|---|---|---|---|
| `set_status` | yes | yes | status pill with icon + color |
| `clear_status` | yes | yes | cleanup |
| `set_agent_pid` | yes | yes | crash recovery — 30s PID polling |
| `clear_agent_pid` | yes | yes | cleanup |
| `notify_target` | yes | yes | workspace-targeted desktop notifications |
| `clear_notifications` | yes | yes | clear stale notifications on new prompt |
| `set_progress` | — | **yes** | progress bar |
| `clear_progress` | — | **yes** | cleanup |
| `log` | — | **yes** | sidebar activity feed |
| `clear_log` | — | **yes** | cleanup |
| `report_git_branch` | — | **yes** | git branch in sidebar |
| `report_meta` | — | **yes** | model metadata |

## architecture

```
~/.cc-cmux/
├── handler.cjs          # 45KB compiled handler (16 events)
├── tab-title-worker.cjs # background AI tab title generator
└── config.json          # feature toggles

/tmp/cc-cmux/
└── <session-id>.json    # per-session state (atomic r/w, mkdir lock)
```

source layout:

```
src/
├── handler.ts           # entry: stdin → route → dispatch → exit 0
├── cmux/
│   ├── socket.ts        # unix socket client (send/fire/sendBatch)
│   └── commands.ts      # typed builders for 12 cmux primitives
├── state/
│   ├── manager.ts       # atomic file state with mkdir locking
│   ├── types.ts         # SessionState, StatusPhase
│   └── progress.ts      # adaptive n/(n+K) algorithm
├── events/
│   ├── session.ts       # SessionStart, SessionEnd
│   ├── tools.ts         # PreToolUse, PostToolUse, PostToolUseFailure
│   ├── flow.ts          # UserPromptSubmit, Stop, StopFailure
│   ├── agents.ts        # SubagentStart, SubagentStop
│   ├── lifecycle.ts     # PreCompact, PostCompact, TaskCompleted, WorktreeCreate
│   └── notifications.ts # Notification, PermissionRequest
├── features/
│   ├── status.ts        # 7-state priority system
│   ├── logger.ts        # per-tool log formatting
│   ├── tab-title.ts     # AI title generation + ownership
│   ├── git.ts           # branch detection, PR extraction
│   └── agents.ts        # visible agent pane spawning
├── config/              # types, loader, defaults
├── installer/           # TUI setup wizard (@clack/prompts)
└── util/                # env detection, stdin reader, tool formatting
```

## prior art

studied and borrowed patterns from:
- [manaflow-ai/cmux](https://github.com/manaflow-ai/cmux) — official integration (PID tracking, `notify_target`, `clear_notifications`)
- [tslateman/cmux-claude-code](https://github.com/tslateman/cmux-claude-code) — first community plugin (self-healing panel recovery, `n/(n+10)` progress)
- [STRML/cc-tab-titles](https://github.com/STRML/cc-tab-titles) — AI tab titles (tab ownership, backgrounded haiku calls)
- [Attamusc/opencode-cmux](https://github.com/Attamusc/opencode-cmux) — gold standard for opencode (state machine, dual transport)
- [Th3Sp3ct3R/cmux-claude-agents](https://github.com/Th3Sp3ct3R/cmux-claude-agents) — visible agent panes (PreToolUse interception)

## uninstall

```bash
# 1. remove hooks from settings.json (keeps your other hooks)
python3 -c "
import json, os
p = os.path.expanduser('~/.claude/settings.json')
s = json.load(open(p))
for event in list(s.get('hooks', {})):
    s['hooks'][event] = [e for e in s['hooks'][event] if not e.get('description','').startswith('cc-cmux:')]
    if not s['hooks'][event]: del s['hooks'][event]
json.dump(s, open(p, 'w'), indent=2)
print('removed cc-cmux hooks')
"

# 2. remove handler files
rm -rf ~/.cc-cmux/

# 3. re-enable cmux's built-in claude integration
defaults write com.cmuxterm.app claudeCodeHooksEnabled -bool true

# 4. restart claude code
```

## troubleshooting

| symptom | cause | fix |
|---|---|---|
| no sidebar panel | cmux not active | check `echo $CMUX_SOCKET_PATH` |
| two status pills | built-in integration still on | cmux Settings → Automation → OFF |
| `PostToolUse:X hook error` | broken old hook in settings.json | remove non-cc-cmux PostToolUse entries |
| no progress bar | feature disabled | `~/.cc-cmux/config.json` → `features.progress: true` |
| no notifications | feature disabled | `~/.cc-cmux/config.json` → `features.notifications: true` |
| handler crashes | node too old | need Node.js 20+ |
| sidebar doesn't update | stale handler | restart claude code to reload hooks |

## license

MIT
