# Network Editor Web

Packet Tracer style browser network lab rebuilt from scratch using the required stack:

- Frontend: TypeScript + React + Vite
- Simulation core: Rust + WebAssembly
- Backend: Go
- Database: PostgreSQL

## Layout

- `web/`: React UI, editor, CLI surface, local fallback storage, and WASM adapter.
- `engine-rust/`: Rust simulation engine intended to compile to WebAssembly.
- `server-go/`: Go HTTP API for signup/login and user project storage.
- `db/`: PostgreSQL schema.
- `alternative/`: source requirement and research documents.

## Development

```bash
npm install
npm run dev
npm run build
```

The web app uses `localStorage` by default. To use the Go API/PostgreSQL backend from the Vite app:

```bash
cp .env.example .env
docker compose up postgres api
VITE_API_URL=http://localhost:8080 npm run dev --workspace web
```

Rust, `wasm-pack`, and Go toolchains are required for:

```bash
npm run build:rust
npm run build:go
```

This environment currently has Node/npm only, so the web build is the first verified build target.

## Implemented Lab Surface

- Project home with create/open/delete, routed sample lab creation, JSON/PTWEB import, `.ptweb` export, and optional API-backed storage.
- `.ptweb` is the app's own project format; Cisco Packet Tracer 6.1 proprietary `.pkt` binary export is not implemented.
- Editor canvas with click-to-place devices, drag positioning, zoom, differentiated device shapes, link labels, and removable cables.
- Device catalog covering routers, switches, firewall, PC, server, AP, hub, copper/serial/fiber/wireless/console links, modules, power, and port state.
- Config and CLI flows for hostnames, interface IPs, admin state, VLAN access/trunk mode, static routes, DHCP pools, DNS host records, ACL/NAT, CDP neighbor view, show filters, and startup-config save.
- Desktop commands for `ipconfig`, `arp -a`, `route print`, `ping`, `nslookup`, and `http` checks.
- Simulation fallback for ARP/ICMP, VLAN-aware L2 traversal, basic static routing, DHCP renew, DNS/HTTP reachability checks, firewall ACL hits, NAT hits, wireless range/security, MAC/ARP learning, events, and diagnostics.
