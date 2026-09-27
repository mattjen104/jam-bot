#!/bin/bash
set -euo pipefail
pnpm install --frozen-lockfile

# A schema introspection/push can block indefinitely on the existing database.
# Only do it when this merge actually touched the schema or Drizzle config.
if git rev-parse --verify HEAD^ >/dev/null 2>&1 &&
   git diff --quiet HEAD^ HEAD -- lib/db/src/schema lib/db/drizzle.config.ts; then
  echo "No database schema changes in this merge; skipping Drizzle push."
else
  # --force skips the final execute confirmation, but the unique-constraint
  # prompt still needs a newline (the non-destructive default).
  # A genuine migration failure must be reported, not hang the whole setup.
  printf '\n' | timeout --signal=TERM --kill-after=5s 90s \
    pnpm --filter @workspace/db run push-force
fi
