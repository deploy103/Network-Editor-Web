# CLI Engine Bridge

This is a dependency-free Python bridge for moving CLI execution out of the React bundle.

## Run

```bash
python3 cli-engine-python/server.py
```

Then set:

```bash
VITE_CLI_ENGINE_URL=http://127.0.0.1:9090
```

The web app sends:

```json
{ "device": {}, "session": { "mode": "exec" }, "command": "show ip route" }
```

to `POST /run` and expects:

```json
{ "device": {}, "session": { "mode": "exec" }, "output": "..." }
```

If FRRouting `vtysh` is installed, the bridge runs commands through `vtysh`. Without `vtysh`, it reports that the bridge is available but no real backend is installed. This keeps the web UI ready for a Python/C++/FRR/GNS3/CML-backed engine without hard-coding that logic into React.
