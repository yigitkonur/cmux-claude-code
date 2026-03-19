#!/bin/bash
# cmux-ssh — SSH wrapper that forwards the cmux socket to the remote machine
#
# usage: cmux-ssh <host> [ssh-args...]
#
# what it does:
#   1. writes workspace/surface IDs to /tmp/cmux-fwd.env
#   2. scp's the env file to the remote machine
#   3. SSH's with -R to forward the cmux socket
#   4. the cc-cmux handler on the remote can now update YOUR sidebar
#
# works with any SSH host. outside cmux, falls through to plain ssh.
# for ET (eternal terminal), run `cmux-ssh -N -f <host>` first as a
# background tunnel, then use `et <host>` normally.

set -e

HOST="${1:?usage: cmux-ssh <host> [ssh-args...]}"
shift

# If not in cmux, just pass through to ssh
if [ -z "$CMUX_SOCKET_PATH" ] || [ ! -S "$CMUX_SOCKET_PATH" ]; then
  exec ssh "$HOST" "$@"
fi

# Ensure symlink exists (cmux socket path has spaces)
SOCK_LINK="/tmp/cmux-local.sock"
if [ ! -S "$SOCK_LINK" ]; then
  ln -sf "$CMUX_SOCKET_PATH" "$SOCK_LINK"
fi

# Write env file with workspace/surface IDs
ENV_FILE="/tmp/cmux-fwd.env"
printf 'export CMUX_WORKSPACE_ID=%s\nexport CMUX_SURFACE_ID=%s\n' \
  "$CMUX_WORKSPACE_ID" "$CMUX_SURFACE_ID" > "$ENV_FILE"

# Copy env file to remote (ignore errors — first use might not have the dir)
scp -q "$ENV_FILE" "$HOST:/tmp/cmux-fwd.env" 2>/dev/null || true

REMOTE_SOCK="/tmp/cmux-fwd.sock"

exec ssh -R "$REMOTE_SOCK:$SOCK_LINK" "$HOST" "$@"
