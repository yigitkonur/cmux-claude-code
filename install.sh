#!/bin/bash
# cmux-claude-code installer
# works on both local (cmux) and remote (SSH) machines
# on machines without cmux, the handler simply no-ops (exits 0 silently)
set -e

INSTALL_DIR="$HOME/.cc-cmux"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo ""
echo "  cmux-claude-code"
echo "  ================"
echo ""

# Create install directory
mkdir -p "$INSTALL_DIR"

# Copy handler files
if [ -f "$SCRIPT_DIR/dist/handler.cjs" ]; then
  cp "$SCRIPT_DIR/dist/handler.cjs" "$INSTALL_DIR/handler.cjs"
  cp "$SCRIPT_DIR/dist/tab-title-worker.cjs" "$INSTALL_DIR/tab-title-worker.cjs"
  echo "  [ok] handler files copied to $INSTALL_DIR/"
else
  echo "  [!!] dist/handler.cjs not found. run 'npm run build' first."
  exit 1
fi

# Create default config if none exists
if [ ! -f "$INSTALL_DIR/config.json" ]; then
  cat > "$INSTALL_DIR/config.json" << 'CONF'
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
CONF
  echo "  [ok] default config created"
else
  echo "  [ok] existing config preserved"
fi

# Verify node is available
if ! command -v node &>/dev/null; then
  echo "  [!!] node not found. cmux-claude-code requires Node.js 20+."
  exit 1
fi

NODE_VERSION=$(node -e "console.log(process.versions.node.split('.')[0])")
if [ "$NODE_VERSION" -lt 20 ]; then
  echo "  [!!] Node.js v$NODE_VERSION detected, need 20+."
  exit 1
fi
echo "  [ok] node v$(node -e 'process.stdout.write(process.versions.node)')"

# Test the handler
echo '{}' | node "$INSTALL_DIR/handler.cjs" 2>/dev/null
if [ $? -eq 0 ]; then
  echo "  [ok] handler verified (clean exit)"
else
  echo "  [!!] handler test failed"
  exit 1
fi

# ---- Disable cmux's built-in Claude Code integration ----
# cmux-claude-code takes over the 'claude_code' status namespace.
# running both causes two systems fighting over the same status pill.
# the preference key is 'claudeCodeHooksEnabled' in com.cmuxterm.app.
if defaults read com.cmuxterm.app claudeCodeHooksEnabled 2>/dev/null | grep -q "1"; then
  defaults write com.cmuxterm.app claudeCodeHooksEnabled -bool false
  echo "  [ok] disabled cmux's built-in claude integration (was enabled)"
  echo "       cmux-claude-code replaces it with 16 hooks vs 6, progress bars,"
  echo "       sidebar logs, 7 status states vs 3, and more."
elif defaults read com.cmuxterm.app claudeCodeHooksEnabled 2>/dev/null | grep -q "0"; then
  echo "  [ok] cmux's built-in claude integration already disabled"
else
  # key doesn't exist — cmux might not be installed or is a different version
  echo "  [--] couldn't detect cmux claude integration preference"
  echo "       if you see two status pills, disable manually:"
  echo "       cmux Settings (Cmd+,) → Automation → Claude Code Integration → OFF"
fi

# Check cmux socket
if [ -n "$CMUX_SOCKET_PATH" ] && [ -S "$CMUX_SOCKET_PATH" ]; then
  echo "  [ok] cmux socket connected"
else
  echo "  [--] cmux not detected — handler will no-op (safe for ssh/remote)"
fi

# ---- Add hooks to settings.json ----
SETTINGS="$HOME/.claude/settings.json"
HANDLER_CMD="node ~/.cc-cmux/handler.cjs"

add_hooks() {
  python3 -c "
import json, os, sys

settings_path = os.path.expanduser('$SETTINGS')

# read existing or create new
if os.path.exists(settings_path):
    with open(settings_path) as f:
        settings = json.load(f)
else:
    os.makedirs(os.path.dirname(settings_path), exist_ok=True)
    settings = {}

handler = '$HANDLER_CMD'

cc_hooks = {
    'SessionStart': [{'description': 'cc-cmux: initialize sidebar, detect git, report model', 'hooks': [{'type': 'command', 'command': handler, 'timeout': 10}]}],
    'SessionEnd': [{'description': 'cc-cmux: clean up sidebar state', 'hooks': [{'type': 'command', 'command': handler, 'timeout': 5}]}],
    'UserPromptSubmit': [{'description': 'cc-cmux: set thinking status, reset progress', 'hooks': [{'type': 'command', 'command': handler, 'timeout': 10}]}],
    'PreToolUse': [{'description': 'cc-cmux: update status and progress bar', 'hooks': [{'type': 'command', 'command': handler, 'timeout': 10}]}],
    'PostToolUse': [{'description': 'cc-cmux: log tool results to sidebar', 'hooks': [{'type': 'command', 'command': handler, 'timeout': 10}]}],
    'PostToolUseFailure': [{'description': 'cc-cmux: log tool errors to sidebar', 'hooks': [{'type': 'command', 'command': handler, 'timeout': 10}]}],
    'PermissionRequest': [{'description': 'cc-cmux: set waiting status, notify on permission', 'hooks': [{'type': 'command', 'command': handler, 'timeout': 10}]}],
    'Stop': [{'description': 'cc-cmux: set done status, complete progress, notify', 'hooks': [{'type': 'command', 'command': handler, 'timeout': 10}]}],
    'StopFailure': [{'description': 'cc-cmux: set error status, notify on failure', 'hooks': [{'type': 'command', 'command': handler, 'timeout': 10}]}],
    'Notification': [{'description': 'cc-cmux: forward notifications to desktop', 'hooks': [{'type': 'command', 'command': handler, 'timeout': 10}]}],
    'SubagentStart': [{'description': 'cc-cmux: track agent spawn in sidebar', 'hooks': [{'type': 'command', 'command': handler, 'timeout': 10}]}],
    'SubagentStop': [{'description': 'cc-cmux: track agent completion in sidebar', 'hooks': [{'type': 'command', 'command': handler, 'timeout': 10}]}],
    'PreCompact': [{'description': 'cc-cmux: log compaction start', 'hooks': [{'type': 'command', 'command': handler, 'timeout': 10}]}],
    'PostCompact': [{'description': 'cc-cmux: log compaction complete', 'hooks': [{'type': 'command', 'command': handler, 'timeout': 10}]}],
    'TaskCompleted': [{'description': 'cc-cmux: log task completion', 'hooks': [{'type': 'command', 'command': handler, 'timeout': 10}]}],
    'WorktreeCreate': [{'description': 'cc-cmux: log worktree creation', 'hooks': [{'type': 'command', 'command': handler, 'timeout': 10}]}],
}

existing = settings.get('hooks', {})
added = 0
for event, entries in cc_hooks.items():
    if event in existing:
        # remove old cc-cmux entries, keep user entries
        user_entries = [e for e in existing[event] if not e.get('description', '').startswith('cc-cmux:')]
        existing[event] = user_entries + entries
    else:
        existing[event] = entries
    added += 1

settings['hooks'] = existing

# backup
import shutil
if os.path.exists(settings_path):
    shutil.copy2(settings_path, settings_path + '.cc-cmux-backup')

with open(settings_path, 'w') as f:
    json.dump(settings, f, indent=2)
    f.write('\n')

print(f'  [ok] {added} hook events merged into settings.json')
print(f'       backup at {settings_path}.cc-cmux-backup')
" 2>&1
}

if [ -f "$SETTINGS" ] && grep -q "cc-cmux:" "$SETTINGS" 2>/dev/null; then
  echo "  [ok] hooks already in settings.json (updating)"
  add_hooks
else
  add_hooks
fi

echo ""
echo "  installed:"
echo "    ~/.cc-cmux/handler.cjs          ($(wc -c < "$INSTALL_DIR/handler.cjs" | tr -d ' ') bytes)"
echo "    ~/.cc-cmux/tab-title-worker.cjs ($(wc -c < "$INSTALL_DIR/tab-title-worker.cjs" | tr -d ' ') bytes)"
echo "    ~/.cc-cmux/config.json"
echo ""
echo "  restart claude code to activate."
echo ""
