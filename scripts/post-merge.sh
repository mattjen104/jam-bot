#!/bin/bash
set -e
pnpm install --frozen-lockfile
# drizzle-kit push --force skips the final "execute?" confirmation but still
# prompts "truncate table?" when adding a unique constraint to a non-empty table.
# Piping a newline selects the default answer ("No, add without truncating").
printf '\n' | pnpm --filter db push-force
