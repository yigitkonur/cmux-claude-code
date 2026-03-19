#!/bin/bash
# cmux-ssh — SSH wrapper that forwards the cmux socket to the remote machine
#
# usage: cmux-ssh <host> [ssh-args...]
#    or: cmux-ssh user@host [ssh-args...]
#
# what it does:
#   1. forwards your local cmux socket to /tmp/cmux-fwd.sock on the remote
#   2. exports CMUX_SOCKET_PATH, CMUX_WORKSPACE_ID, CMUX_SURFACE_ID on the remote
#   3. the cc-cmux handler on the remote machine can now update YOUR sidebar
#
# works transparently — just replace `ssh` with `cmux-ssh` when using cmux.
# outside cmux (no CMUX_SOCKET_PATH), falls through to plain ssh.

set -e

# If not in cmux, just pass through to ssh
if [ -z "$CMUX_SOCKET_PATH" ] || [ ! -S "$CMUX_SOCKET_PATH" ]; then
  exec ssh "$@"
fi

HOST="$1"
shift

if [ -z "$HOST" ]; then
  echo "usage: cmux-ssh <host> [ssh-args...]" >&2
  exit 1
fi

REMOTE_SOCK="/tmp/cmux-fwd.sock"

# Build environment exports for the remote shell
REMOTE_ENV="export CMUX_SOCKET_PATH=$REMOTE_SOCK"
REMOTE_ENV="$REMOTE_ENV; export CMUX_WORKSPACE_ID=$CMUX_WORKSPACE_ID"
REMOTE_ENV="$REMOTE_ENV; export CMUX_SURFACE_ID=$CMUX_SURFACE_ID"
REMOTE_ENV="$REMOTE_ENV; export CMUX_SSH_HOST=$(hostname -s)"

exec ssh \
  -R "$REMOTE_SOCK:$CMUX_SOCKET_PATH" \
  -o "SendEnv=CMUX_WORKSPACE_ID CMUX_SURFACE_ID" \
  -t "$HOST" "$@" \
  "$REMOTE_ENV; exec \$SHELL -l"
