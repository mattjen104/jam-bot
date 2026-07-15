#!/usr/bin/env bash
# refresh-spinitron-fixtures.sh
#
# Re-fetches the Spinitron station pages used as HTML fixtures for
# parseSpinitronWebPage regression tests and writes them to
# artifacts/api-server/test/fixtures/.
#
# Run this whenever you suspect Spinitron has changed their page structure,
# then update the vitest snapshots to confirm the parser still works:
#
#   ./scripts/refresh-spinitron-fixtures.sh
#   pnpm --filter api-server test -- --update-snapshots
#
# The fetch uses curl with a browser User-Agent so Spinitron doesn't
# return a bot-challenge page. A non-2xx response exits the script
# immediately so you do not silently overwrite a good fixture with an
# error page.

set -euo pipefail

FIXTURE_DIR="$(cd "$(dirname "$0")/../artifacts/api-server/test/fixtures" && pwd)"

fetch_fixture() {
  local station="$1"   # e.g. WPRB
  local out="$2"       # e.g. spinitron-wprb.html
  local url="https://spinitron.com/${station}/"

  echo "Fetching ${url} → ${out} ..."

  local http_code
  http_code=$(curl -sL \
    --user-agent "Mozilla/5.0 (compatible; fixture-refresh/1.0)" \
    --max-time 30 \
    --write-out "%{http_code}" \
    --output "${FIXTURE_DIR}/${out}" \
    "${url}")

  if [[ "${http_code}" != 2* ]]; then
    echo "ERROR: ${url} returned HTTP ${http_code}. Fixture NOT updated." >&2
    rm -f "${FIXTURE_DIR}/${out}"
    exit 1
  fi

  echo "  OK (HTTP ${http_code})"
}

fetch_fixture "WPRB" "spinitron-wprb.html"
fetch_fixture "WMFO" "spinitron-wmfo.html"

echo ""
echo "Fixtures refreshed. Next step:"
echo "  pnpm --filter api-server test -- --update-snapshots"
