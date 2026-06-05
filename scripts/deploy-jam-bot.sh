#!/usr/bin/env bash
#
# Deploy the self-hosted jam-bot Slack service.
#
# Run this as root on the droplet:
#
#     sudo bash scripts/deploy-jam-bot.sh
#
# It pulls, installs, builds, and restarts the bot ENTIRELY as the `jam` user,
# so the repo never ends up with a mix of root- and jam-owned files (that split
# is what breaks `git pull` writing to .git/objects and leaves stale installs).
#
# Override the defaults with env vars if your layout differs:
#     REPO_DIR=/path/to/jam-bot-repo SERVICE=jam-bot RUN_USER=jam \
#         sudo -E bash scripts/deploy-jam-bot.sh

set -euo pipefail

REPO_DIR="${REPO_DIR:-/mnt/volume_sfo3_01/opt/jam-bot-repo}"
RUN_USER="${RUN_USER:-jam}"
SERVICE="${SERVICE:-jam-bot}"
FILTER="${FILTER:-@workspace/jam-bot}"

log() { printf '\n\033[1;36m==> %s\033[0m\n' "$1"; }

if [[ ! -d "$REPO_DIR/.git" ]]; then
  echo "ERROR: $REPO_DIR is not a git repo (no .git). Set REPO_DIR to the repo root." >&2
  exit 1
fi

# 1. Hand the whole repo back to the run user so git/pnpm never hit permission
#    errors and we don't recreate a root/jam ownership split.
log "Fixing ownership of $REPO_DIR -> $RUN_USER"
chown -R "$RUN_USER":"$RUN_USER" "$REPO_DIR"

# 2. Pull + install + build, all as the run user, from the repo root.
log "Pulling, installing, and building as $RUN_USER"
sudo -u "$RUN_USER" bash -lc "
  set -euo pipefail
  cd '$REPO_DIR'
  git pull
  pnpm install
  pnpm --filter '$FILTER' run build
"

# 3. Restart the service (needs root).
log "Restarting $SERVICE"
systemctl restart "$SERVICE"

log "Done. Recent service status:"
systemctl --no-pager --lines=10 status "$SERVICE" || true
