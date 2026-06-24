#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${VISUAL_SMOKE_PORT:-4173}"
LOG_FILE="$(mktemp /tmp/network-visual-smoke-XXXXXX.log)"

cleanup() {
  if [[ -n "${SERVER_PID:-}" ]]; then
    kill "$SERVER_PID" >/dev/null 2>&1 || true
  fi
  rm -f "$LOG_FILE"
}
trap cleanup EXIT

npm run preview --workspace web -- --host 127.0.0.1 --port "$PORT" >"$LOG_FILE" 2>&1 &
SERVER_PID=$!

for _ in {1..60}; do
  if node -e "fetch('http://127.0.0.1:${PORT}').then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" >/dev/null 2>&1; then
    break
  fi
  sleep 0.5
done

if ! kill -0 "$SERVER_PID" >/dev/null 2>&1; then
  cat "$LOG_FILE"
  exit 1
fi

if ! ldconfig -p 2>/dev/null | grep -q "libnspr4"; then
  echo "Playwright Chromium dependency missing: libnspr4.so. Install browser dependencies with 'npx playwright install-deps chromium' or the OS package that provides libnspr4."
  exit 1
fi

node "$ROOT/scripts/visual-smoke.cjs" "http://127.0.0.1:${PORT}"
