#!/bin/bash
# cmux-claude-pro remote setup
# run this on any remote machine (SSH/ET target) to enable sidebar integration.
#
# usage: bash remote-setup.sh
#
# what it does:
#   1. installs the handler to ~/.cc-cmux/ (if not already there)
#   2. adds socket auto-detection to your shell profile
#   3. works with any connection method (ssh, et, mosh) as long as
#      the cmux socket is forwarded to /tmp/cmux-fwd.sock
#
# the handler no-ops gracefully when the socket isn't available.

set -e

echo ""
echo "  cmux-claude-pro remote setup"
echo "  ============================"
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
if grep -q "cmux-claude-pro" "$PROFILE" 2>/dev/null; then
  echo "  [ok] shell profile already configured ($PROFILE)"
else
  cat >> "$PROFILE" << 'BLOCK'

# cmux-claude-pro: detect forwarded cmux socket for SSH/ET sidebar integration
# the local machine forwards its cmux socket to /tmp/cmux-fwd.sock via SSH -R
# this gives the remote cc-cmux handler access to update the local sidebar
if [ -S /tmp/cmux-fwd.sock ] && [ -n "$SSH_CONNECTION" ]; then
  export CMUX_SOCKET_PATH=/tmp/cmux-fwd.sock
  # read workspace/surface IDs if the local machine wrote them
  if [ -f /tmp/cmux-fwd.env ]; then
    . /tmp/cmux-fwd.env
  fi
fi
BLOCK
  echo "  [ok] added cmux socket detection to $PROFILE"
fi

# Check if handler is installed
if [ -f "$HOME/.cc-cmux/handler.cjs" ]; then
  echo "  [ok] handler already installed at ~/.cc-cmux/"
else
  echo "  [!!] handler not found at ~/.cc-cmux/"
  echo "       copy from your local machine:"
  echo "       scp ~/.cc-cmux/handler.cjs ~/.cc-cmux/config.json $(hostname):~/.cc-cmux/"
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
echo "  1. create symlink (spaces in cmux socket path break SSH):"
echo "     ln -sf \"\$CMUX_SOCKET_PATH\" /tmp/cmux-local.sock"
echo ""
echo "  2. add to your SSH config (~/.ssh/config):"
echo "     Host $(hostname)"
echo "       RemoteForward /tmp/cmux-fwd.sock /tmp/cmux-local.sock"
echo ""
echo "  3. on the remote machine's sshd_config (one-time, needs sudo):"
echo "     echo \"StreamLocalBindUnlink yes\" | sudo tee -a /etc/ssh/sshd_config"
echo "     sudo launchctl kickstart -k system/com.openssh.sshd  # macOS"
echo "     # or: sudo systemctl restart sshd                    # Linux"
echo ""
echo "  4. for ET (eternal terminal): run an SSH tunnel alongside ET:"
echo "     ssh -N -f -R /tmp/cmux-fwd.sock:/tmp/cmux-local.sock $(hostname)"
echo "     et $(hostname)"
echo ""
