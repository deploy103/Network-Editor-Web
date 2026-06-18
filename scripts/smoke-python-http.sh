#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${CLI_ENGINE_TEST_PORT:-19190}"
BASE="http://127.0.0.1:${PORT}"
PID=""

cleanup() {
  if [[ -n "${PID}" ]] && kill -0 "${PID}" >/dev/null 2>&1; then
    kill "${PID}" >/dev/null 2>&1 || true
    wait "${PID}" >/dev/null 2>&1 || true
  fi
}

trap cleanup EXIT INT TERM

cd "${ROOT}"
CLI_ENGINE_PORT="${PORT}" python3 cli-engine-python/server.py >/tmp/network-python-cli-http.log 2>&1 &
PID="$!"

for _ in {1..80}; do
  if curl -fsS "${BASE}/health" >/dev/null 2>&1; then
    break
  fi
  sleep 0.1
done

curl -fsS "${BASE}/health" | python3 -c 'import json,sys; data=json.load(sys.stdin); assert data["status"] == "ok" and data["backend"] == "python"'

python3 - "${BASE}" <<'PY'
import json
import sys
import urllib.request

base = sys.argv[1]
device = {
    "label": "Router0",
    "config": {"hostname": "Router0", "services": {"http": False, "dhcp": False, "dns": False, "tftp": False, "syslog": False}},
    "ports": [{"id": "g0", "name": "GigabitEthernet0/0", "kind": "gigabit-ethernet", "mode": "routed", "adminUp": True, "allowedVlans": [1], "vlan": 1}],
    "runtime": {"arpTable": [], "macTable": [], "dhcpLeases": [], "logs": []},
}
session = {"mode": "exec"}


def post(path, payload):
    req = urllib.request.Request(
        f"{base}{path}",
        data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=5) as response:
        return json.loads(response.read().decode())


result = post("/run", {"device": device, "session": session, "command": "enable"})
assert result["session"]["mode"] == "privileged"
device = result["device"]
session = result["session"]
result = post("/run", {"device": device, "session": session, "command": "show version"})
assert "Python IOS" in result["output"]
complete = post("/complete", {"device": device, "session": session, "input": "show int c"})
assert "show interfaces counters" in complete["items"]
prompt = post("/prompt", {"device": device, "session": session})
assert prompt["prompt"] == "Router0#"
print("Python CLI HTTP smoke tests passed")
PY
