#!/usr/bin/env python3
import json
import os
import shutil
import subprocess
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


HOST = os.getenv("CLI_ENGINE_HOST", "127.0.0.1")
PORT = int(os.getenv("CLI_ENGINE_PORT", "9090"))
TIMEOUT = float(os.getenv("CLI_ENGINE_TIMEOUT", "3"))


def prompt(device, session):
    hostname = device.get("config", {}).get("hostname") or device.get("label") or "Router"
    mode = session.get("mode", "exec")
    if mode == "exec":
        return f"{hostname}>"
    if mode == "global":
        return f"{hostname}(config)#"
    if mode == "interface":
        return f"{hostname}(config-if)#"
    if mode == "line":
        return f"{hostname}(config-line)#"
    if mode == "router":
        return f"{hostname}(config-router)#"
    return f"{hostname}#"


def next_session(session, command):
    mode = session.get("mode", "exec")
    lower = " ".join(command.strip().lower().split())
    if not lower:
        return session
    if lower in ("enable", "en"):
        return {"mode": "privileged"}
    if lower in ("disable",):
        return {"mode": "exec"}
    if lower in ("configure terminal", "conf t"):
        return {"mode": "global"} if mode == "privileged" else session
    if lower == "end":
        return {"mode": "privileged"}
    if lower == "exit":
        if mode == "global":
            return {"mode": "privileged"}
        if mode in ("interface", "line", "router", "vlan", "dhcp"):
            return {"mode": "global"}
        return {"mode": "exec"}
    if mode == "global" and lower.startswith("interface "):
        return {"mode": "interface"}
    if mode == "global" and lower.startswith("line "):
        return {"mode": "line"}
    if mode == "global" and lower.startswith("router "):
        return {"mode": "router"}
    return session


def run_vtysh(command, session):
    if not shutil.which("vtysh"):
        return None
    args = ["vtysh"]
    mode = session.get("mode", "exec")
    if mode in ("global", "interface", "line", "router"):
        args.extend(["-c", "configure terminal"])
    args.extend(["-c", command])
    completed = subprocess.run(args, check=False, capture_output=True, text=True, timeout=TIMEOUT)
    output = (completed.stdout + completed.stderr).strip()
    return output


def handle_run(payload):
    device = payload.get("device") or {}
    session = payload.get("session") or {"mode": "exec"}
    command = str(payload.get("command") or "")
    output = run_vtysh(command, session)
    if output is None:
        output = "% External CLI bridge is running, but FRR vtysh was not found. Install FRR or leave VITE_CLI_ENGINE_URL empty to use the browser simulator."
    return {"device": device, "session": next_session(session, command), "output": output}


class Handler(BaseHTTPRequestHandler):
    def do_OPTIONS(self):
        self.send_response(204)
        self.send_cors()
        self.end_headers()

    def do_GET(self):
        if self.path != "/health":
            self.write_json(404, {"error": "not found"})
            return
        self.write_json(200, {"status": "ok", "vtysh": bool(shutil.which("vtysh"))})

    def do_POST(self):
        if self.path != "/run":
            self.write_json(404, {"error": "not found"})
            return
        length = min(int(self.headers.get("Content-Length", "0")), 5_000_000)
        try:
            payload = json.loads(self.rfile.read(length) or b"{}")
            self.write_json(200, handle_run(payload))
        except Exception as exc:
            self.write_json(500, {"error": str(exc)})

    def write_json(self, status, payload):
        raw = json.dumps(payload).encode()
        self.send_response(status)
        self.send_cors()
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def send_cors(self):
        self.send_header("Access-Control-Allow-Origin", os.getenv("CLI_ENGINE_CORS_ORIGIN", "*"))
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")


if __name__ == "__main__":
    print(f"CLI engine bridge listening on http://{HOST}:{PORT}")
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()
