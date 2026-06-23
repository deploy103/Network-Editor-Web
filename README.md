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

## Development

```bash
npm install
npm run dev
npm run check:web
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

- Project home with create/open/search/sort, service-aware workspace stats/search, duplicate/delete confirmation, routed sample lab creation, JSON/PTWEB import preview, `.ptweb` export, and optional API-backed storage.
- `.ptweb` is the app's own project format; Cisco Packet Tracer 6.1 proprietary `.pkt` binary export is not implemented.
- Editor canvas with click-to-place devices, drag positioning, zoom, differentiated device shapes, link labels, and removable cables.
- Device catalog covering routers, switches, firewall, PC, server, AP, hub, copper/serial/fiber/wireless/console links, modules, power, and port state.
- Config and CLI flows for hostnames, interface IPs, DHCP helper addresses, admin state, VLAN access/trunk mode, static routes, DHCP pools/excluded ranges, DNS host records, HTTP/FTP/EMAIL/DHCP/DNS/TFTP/SYSLOG services, SSH/Telnet line access, ACL/NAT, CDP neighbor view, `show services`, service logs, route/MAC/ARP/DHCP/host/protocol filters, show pipe filters, and startup-config save.
- Services panels include DHCP binding export/release, DNS record export, per-service logs, log search, CSV export, and duplicate DHCP/DNS record validation.
- Desktop commands for `help`, `ipconfig`, `ipconfig /displaydns`, `ipconfig /flushdns`, `arp -a`, `route print`, `netstat -r`, `ping -n`, `tracert`, `nslookup`, `http`/`web`, `ftp`, `email`/`mail`, `ssh`, `telnet`, `tftp`, and `syslog` checks.
- Simulation fallback for ARP/ICMP, VLAN-aware L2 traversal, basic static routing, DHCP renew and relay with matching pool selection and subnet-bounded leasing, DNS/HTTP/FTP/EMAIL/TFTP/SYSLOG/SSH/TELNET reachability checks, firewall ACL hits, NAT hits, wireless range/security, MAC/ARP learning, events, subnet-mask/DHCP helper/excluded-range diagnostics, and service-aware diagnostic report export.
- Simulation dock filtering for events, OSI layer, diagnostics, cables, user-created packets, full OSI 1-7 PDU detail views, selected PDU CSV export, and playback controls.
