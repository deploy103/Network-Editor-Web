# Python IOS CLI Engine

This dependency-free Python service owns IOS-style CLI command parsing, device state updates, and command output generation. The React frontend should only render the terminal and send commands to this process.

## Run

```bash
npm run dev
```

The root dev script starts this Python server and then runs Vite with:

```bash
VITE_CLI_ENGINE_URL=http://127.0.0.1:9090
```

To run only the engine:

```bash
npm run dev:cli
```

The web app sends:

```json
{ "device": {}, "session": { "mode": "exec" }, "command": "show ip route" }
```

to `POST /run` and expects:

```json
{ "device": {}, "session": { "mode": "exec" }, "output": "..." }
```

Additional Python-owned terminal APIs:

```text
POST /complete  -> { "items": ["show ip route", "..."] }
POST /prompt    -> { "prompt": "Router0#" }
GET  /health    -> { "status": "ok", "backend": "python" }
```

The default backend is the built-in Python IOS simulator. Optional FRRouting `vtysh` passthrough is still available with:

```bash
CLI_ENGINE_BACKEND=vtysh python3 cli-engine-python/server.py
```

## Test

```bash
npm run smoke:python-cli
```
