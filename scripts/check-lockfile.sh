#!/usr/bin/env bash
# Verify that pnpm-lock.yaml is in sync with all package.json manifests.
# Run this in CI (or locally before pushing) to catch lockfile drift early.
# post-merge.sh already invokes pnpm install --frozen-lockfile; this script
# is a lightweight standalone check for pre-push hooks or additional CI steps.
set -euo pipefail
pnpm install --frozen-lockfile --prefer-offline
echo "Lockfile is in sync."
