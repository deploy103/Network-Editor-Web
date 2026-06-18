#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CLI_ENGINE_HOST="${CLI_ENGINE_HOST:-127.0.0.1}"
CLI_ENGINE_PORT="${CLI_ENGINE_PORT:-9090}"
CLI_URL="${VITE_CLI_ENGINE_URL:-http://${CLI_ENGINE_HOST}:${CLI_ENGINE_PORT}}"
CLI_PID=""

health_ok() {
  command -v curl >/dev/null 2>&1 && curl -fsS "${CLI_URL}/health" >/dev/null 2>&1
}

cleanup() {
  if [[ -n "${CLI_PID}" ]] && kill -0 "${CLI_PID}" >/dev/null 2>&1; then
    kill "${CLI_PID}" >/dev/null 2>&1 || true
    wait "${CLI_PID}" >/dev/null 2>&1 || true
  fi
}

trap cleanup EXIT INT TERM

cd "${ROOT}"

if health_ok; then
  echo "Using existing Python CLI engine at ${CLI_URL}"
else
  echo "Starting Python CLI engine at ${CLI_URL}"
  CLI_ENGINE_HOST="${CLI_ENGINE_HOST}" CLI_ENGINE_PORT="${CLI_ENGINE_PORT}" python3 cli-engine-python/server.py &
  CLI_PID="$!"
  for _ in {1..50}; do
    if health_ok; then
      break
    fi
    sleep 0.1
  done
  if ! health_ok; then
    echo "Python CLI engine did not become healthy at ${CLI_URL}" >&2
    exit 1
  fi
fi

VITE_CLI_ENGINE_URL="${CLI_URL}" npm run dev --workspace web
