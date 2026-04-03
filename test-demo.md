# cmux-claude-code — interactive test script

paste the prompt below into a fresh claude code session to see every sidebar feature in action. works in any directory — even an empty folder. creates temp files, exercises every hook, then cleans up after itself.

> **prerequisite:** cmux-claude-code installed, cmux's built-in claude integration disabled, claude code restarted.

---

## paste this into claude code:

```
run this test script step by step. wait 2 seconds between each step so i can
watch the cmux sidebar update. announce each step number before executing it.

step 1 — WRITE (creates a test file)
create a file /tmp/cmux-test-alpha.txt with this content:
"hello from cmux-claude-code
this file tests the sidebar integration
TODO: verify grep finds this line
export const status = 'working';"

step 2 — WRITE (creates a second test file)
create a file /tmp/cmux-test-beta.txt with this content:
"second test file for cmux-claude-code
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
run: echo "cmux-claude-code sidebar test — all tools working"

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
ask me: "test complete — all cmux-claude-code sidebar features verified! want me to delete the test files?"
if i say yes, delete them. if i say no, leave them.
```

---

## what to watch for

### status pill (top of sidebar panel)

| step | expected status | icon | color |
|---|---|---|---|
| session start | `Ready` | checkmark.circle | green |
| any prompt | `Thinking...` | brain | gold |
| 1-2 | `Working: Write: cmux-test-alpha.txt` | hammer.fill | blue |
| 3 | `Working: Read: cmux-test-alpha.txt` | hammer.fill | blue |
| 4 | `Working: Grep: "TODO"` | hammer.fill | blue |
| 5 | `Working: Glob: cmux-test-*` | hammer.fill | blue |
| 6 | `Working: Edit: cmux-test-alpha.txt` | hammer.fill | blue |
| 7-8 | `Working: Bash: cat /tmp/cmux...` | hammer.fill | blue |
| 9 | brief flash (failure doesn't change status) | — | — |
| 10 | `Working: TaskCreate` / `Working: TaskUpdate` | hammer.fill | blue |
| 11 | `Working (1 agent): ...` | hammer.fill | blue |
| 12 | `Working: Read: ...` | hammer.fill | blue |
| 13 (done) | `Done` | checkmark.seal | green |

### progress bar

| when | expected |
|---|---|
| after step 1 | `0.09 — 1 tool` |
| after step 5 | `0.33 — 5 tools` |
| after step 8 | `0.44 — 8 tools` |
| after step 12 | ~`0.58 — 14 tools` |
| after step 13 | `1.00 — Complete` (full bar) |

### sidebar log entries

| step | expected log entry |
|---|---|
| 1 | `[claude] [info] Write: cmux-test-alpha.txt` |
| 2 | `[claude] [info] Write: cmux-test-beta.txt` |
| 3 | `[claude] [info] Read: cmux-test-alpha.txt` |
| 4 | `[claude] [info] Grep: "TODO" → 2 matches` |
| 5 | `[claude] [info] Glob: cmux-test-*.txt` |
| 6 | `[claude] [info] Edit: cmux-test-alpha.txt` |
| 7 | `[claude] [info] Bash: \`cat /tmp/cmux...\`` |
| 8 | `[claude] [info] Bash: \`echo "cmux-claude...\`` |
| 9 | `[claude] [warning] FAIL Read: cmux-test-this...` |
| 10 | `[claude] [info] TaskCreate` + `[claude] [success] Task completed` |
| 11 | `[claude] [info] Agent spawned: Explore` + `[claude] [success] Agent done: Explore` |
| 12 | 2x `[claude] [info] Read: ...` entries |

### desktop notification

| when | expected |
|---|---|
| after step 13 | macOS notification: "Claude Code / Done / test complete..." |

### files created (cleaned up at end)

| file | created by | purpose |
|---|---|---|
| `/tmp/cmux-test-alpha.txt` | step 1 | test Write, Read, Grep, Edit |
| `/tmp/cmux-test-beta.txt` | step 2 | test Write, Grep, parallel Read |

---

## troubleshooting

| symptom | cause | fix |
|---|---|---|
| no sidebar panel at all | cmux not active | check `echo $CMUX_SOCKET_PATH` |
| two status pills | built-in cmux integration still on | cmux Settings → Automation → OFF |
| `PostToolUse:X hook error` in terminal | broken old hook in settings.json | remove non-cc-cmux entries from PostToolUse |
| no progress bar | progress feature disabled | `~/.cc-cmux/config.json` → `features.progress: true` |
| no log entries | logs feature disabled | `~/.cc-cmux/config.json` → `features.logs: true` |
| no notifications | notifications disabled | `~/.cc-cmux/config.json` → `features.notifications: true` |
| handler crashes | node version too old | need Node.js 20+ (`node --version`) |
| sidebar doesn't update | stale handler from old session | restart claude code to reload hooks |
