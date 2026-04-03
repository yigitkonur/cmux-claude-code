#!/bin/bash
# cmux-claude-code remote setup
# run this on any remote machine (SSH/ET target) to enable sidebar integration.
#
# usage: bash remote-setup.sh
#
# what it does:
#   1. installs the handler to ~/.cc-cmux/ (if not already there)
#   2. adds socket auto-detection to your shell profile
#   3. configures sshd to accept cmux env vars (AcceptEnv)
#   4. works with any connection method (ssh, et, mosh) as long as
#      the cmux socket is forwarded to /tmp/cmux-fwd.sock
#
# the handler no-ops gracefully when the socket isn't available.

set -e

echo ""
echo "  cmux-claude-code remote setup"
echo "  ============================="
echo ""

# Detect shell profile
if [ -f "$HOME/.zshrc" ]; then
  PROFILE="$HOME/.zshrc"
elif [ -f "$HOME/.bashrc" ]; then
  PROFILE="$HOME/.bashrc"
elif [ -f "$HOME/.bash_profile" ]; then
  PROFILE="$HOME/.bash_profile"
else
  PROFILE="$HOME/.zshrc"
  touch "$PROFILE"
fi

# Add cmux socket detection if not already present
if grep -q "cmux-claude-code" "$PROFILE" 2>/dev/null; then
  echo "  [ok] shell profile already configured ($PROFILE)"
else
  cat >> "$PROFILE" << 'BLOCK'

# cmux-claude-code: detect forwarded cmux socket for SSH/ET sidebar integration
# SSH SendEnv/AcceptEnv provides correct per-connection workspace/surface IDs.
# Env file is fallback only (for ET/mosh where SendEnv is unavailable).
if [ -S /tmp/cmux-fwd.sock ] && [ -n "$SSH_CONNECTION" ]; then
  export CMUX_SOCKET_PATH=/tmp/cmux-fwd.sock
  if [ -z "$CMUX_WORKSPACE_ID" ] && [ -f /tmp/cmux-fwd.env ]; then
    . /tmp/cmux-fwd.env
  fi
fi
BLOCK
  echo "  [ok] added cmux socket detection to $PROFILE"
fi

# Configure sshd to accept cmux env vars
SSHD_CONFIG="/etc/ssh/sshd_config"
if grep -q "AcceptEnv.*CMUX" "$SSHD_CONFIG" 2>/dev/null; then
  echo "  [ok] sshd already accepts CMUX env vars"
else
  echo "  [..] configuring sshd to accept CMUX env vars (needs sudo)..."
  if echo "AcceptEnv CMUX_WORKSPACE_ID CMUX_SURFACE_ID CMUX_TAB_ID CMUX_PANEL_ID" | sudo tee -a "$SSHD_CONFIG" >/dev/null 2>&1; then
    echo "  [ok] added AcceptEnv to $SSHD_CONFIG"
  else
    echo "  [!!] could not write to $SSHD_CONFIG — run manually:"
    echo "       echo \"AcceptEnv CMUX_WORKSPACE_ID CMUX_SURFACE_ID CMUX_TAB_ID CMUX_PANEL_ID\" | sudo tee -a $SSHD_CONFIG"
  fi
fi

# Configure StreamLocalBindUnlink (allows socket reuse across reconnects)
if grep -q "StreamLocalBindUnlink yes" "$SSHD_CONFIG" 2>/dev/null; then
  echo "  [ok] StreamLocalBindUnlink already enabled"
else
  echo "  [..] enabling StreamLocalBindUnlink (needs sudo)..."
  if echo "StreamLocalBindUnlink yes" | sudo tee -a "$SSHD_CONFIG" >/dev/null 2>&1; then
    echo "  [ok] added StreamLocalBindUnlink to $SSHD_CONFIG"
  else
    echo "  [!!] could not write to $SSHD_CONFIG — run manually:"
    echo "       echo \"StreamLocalBindUnlink yes\" | sudo tee -a $SSHD_CONFIG"
  fi
fi

# Restart sshd if we made changes
if ! grep -q "AcceptEnv.*CMUX" "$SSHD_CONFIG" 2>/dev/null; then
  : # Skip restart if config wasn't updated
elif [ "$(uname)" = "Darwin" ]; then
  sudo launchctl kickstart -k system/com.openssh.sshd 2>/dev/null && \
    echo "  [ok] sshd restarted (macOS)" || \
    echo "  [!!] could not restart sshd — run: sudo launchctl kickstart -k system/com.openssh.sshd"
else
  sudo systemctl restart sshd 2>/dev/null && \
    echo "  [ok] sshd restarted (Linux)" || \
    echo "  [!!] could not restart sshd — run: sudo systemctl restart sshd"
fi

# Check if handler is installed
if [ -f "$HOME/.cc-cmux/handler.cjs" ]; then
  echo "  [ok] handler already installed at ~/.cc-cmux/"
else
  echo "  [!!] handler not found at ~/.cc-cmux/"
  echo "       copy from your local machine:"
  echo "       scp ~/.cc-cmux/handler.cjs $(hostname):~/.cc-cmux/"
fi

# Check node
if command -v node &>/dev/null; then
  echo "  [ok] node $(node -e 'process.stdout.write(process.versions.node)')"
else
  echo "  [!!] node not found — install Node.js 20+"
fi

echo ""
echo "  local machine setup (run on your mac):"
echo ""
echo "  1. create symlink (spaces in cmux socket path break SSH -R):"
echo "     ln -sf \"\$CMUX_SOCKET_PATH\" /tmp/cmux-local.sock"
echo ""
echo "  2. add to your SSH config (~/.ssh/config):"
echo "     Host $(hostname)"
echo "       RemoteForward /tmp/cmux-fwd.sock /tmp/cmux-local.sock"
echo "       SendEnv CMUX_WORKSPACE_ID CMUX_SURFACE_ID CMUX_TAB_ID CMUX_PANEL_ID"
echo ""
echo "  3. for ET (eternal terminal): write env file before connecting:"
echo "     printf 'export CMUX_WORKSPACE_ID=%s\nexport CMUX_SURFACE_ID=%s\n' \\"
echo "       \"\$CMUX_WORKSPACE_ID\" \"\$CMUX_SURFACE_ID\" | ssh $(hostname) 'cat > /tmp/cmux-fwd.env'"
echo "     ssh -N -f -R /tmp/cmux-fwd.sock:/tmp/cmux-local.sock $(hostname)"
echo "     et $(hostname)"
echo ""
