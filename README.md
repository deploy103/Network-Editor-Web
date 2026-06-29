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

Optional browser layout smoke coverage is available with:

```bash
npm run smoke:visual
```

It requires Playwright Chromium system dependencies such as `libnspr4.so`.

## Implemented Lab Surface

- Project home with create/open/search/sort, service-aware workspace stats/search, duplicate/delete confirmation, routed sample lab creation, JSON/PTWEB import preview, `.ptweb` export, and optional API-backed storage.
- App shell includes a generated network-device favicon, theme color, and web app manifest.
- `.ptweb` is the app's own project format; Cisco Packet Tracer 6.1 proprietary `.pkt` binary export is not implemented.
- Editor canvas with click-to-place devices, drag positioning, keyboard nudging, zoom, logical/physical workspace modes with rack/desk/wireless grouping and physical auto-arrange, differentiated device shapes, workspace notes, Packet Tracer-style drawing annotations with resize handles and freehand strokes, minimap navigation for devices/notes/drawings, workspace search across devices/IPs/links/notes/drawings, link labels, and removable cables.
- Device catalog covering routers, switches, firewall, PC, server, AP, hub, copper/serial/fiber/wireless/console links, modules, power, port state, Physical tab port inspection, cable trace, and explicit cable disconnect.
- Config and CLI flows for hostnames, interface IPs, DHCP helper addresses, admin state, VLAN access/trunk mode, static and tracked floating routes with best-match/CIDR lookup, DHCP pools/excluded ranges plus pool/binding summaries, STP/DHCP snooping/port-security summaries, DNS host records, HTTP/FTP/EMAIL/DHCP/DNS/TFTP/SYSLOG services, SSH/Telnet line access, ACL summary, NAT, route-map and prefix-list summary/detail, CDP/LLDP summaries and neighbor views, `test cable-diagnostics tdr`, `show cable-diagnostics tdr`, `show services`, service summaries, service logs and log summaries, logging summaries, host summaries, ARP/MAC summaries, route/MAC/ARP/DHCP/host/protocol filters, show pipe filters, and startup-config save.
- Services panels include DHCP binding export/release, DNS record export, per-service logs, log search, CSV export, and duplicate DHCP/DNS record validation.
- Desktop apps and commands for IP configuration, Command Prompt, console-cable Terminal, Web Browser, FTP, Email, TFTP, Syslog, `help`, `hostname`, `getmac`, `getmac /v`, `ipconfig`, `ipconfig /displaydns` A/PTR cache output, `ipconfig /flushdns`, `netsh interface ip show config`, slash/dash `arp -a`/`arp -d`, `route print -4`, `netstat -r`/`-rn`, spaced or combined `netstat -an`/`-ano`/`-abno`, `tasklist /svc` PID mapping, `Get-NetTCPConnection` TCP listener owning-process evidence, `Get-Process -Id` process identity checks, `sc queryex` service state/PID checks, `Test-NetConnection`/`tnc` port and `-CommonTCPPort` checks, `ping -4 -n`, `tracert -d`, `pathping -n`, directed `nslookup [-type A|PTR] <name> [server]`, `http`/`web`, `ftp`, `email`/`mail`, `ssh [-l user] [-p 22]`, `telnet <host> [23]`, `tftp`, and `syslog` checks.
- Simulation fallback for ARP/ICMP, VLAN-aware L2 traversal, basic static routing, DHCP renew and relay with matching pool selection and subnet-bounded leasing, DNS/HTTP/FTP/EMAIL/TFTP/SYSLOG/SSH/TELNET reachability checks, firewall ACL hits, NAT hits, wireless range/security, MAC/ARP learning, events, subnet-mask/DHCP helper/excluded-range diagnostics, and service-aware diagnostic report export.
- Simulation dock filtering for events, selected packet scope, OSI layer, diagnostics, cables with TDR summaries, user-created packets, full OSI 1-7 PDU detail views, explicit PDU protocol/port/operation header rows, selected PDU CSV export, project-report PDU header summaries, and playback controls.
- Activity Wizard-style Instructions/Check Results window with stored instructor requirements, answer topology snapshots, per-command and ordered startup-config scoring rules, CLI command output assertions with active local/remote CLI engine revalidation, per-interface expected values, packet-header assertions, normal copper TDR link requirements, topology, power, workspace documentation, addressing, service, simulation, and startup-config scoring plus TXT export.
- Report, instructor workbook, and verification-plan exports covering inventory, address/capacity/security/routing/service/wireless/audit/drift/failure/runtime evidence, Desktop `netsh` adapter evidence, `Test-NetConnection` port checks, `tasklist /svc`, `Get-NetTCPConnection`, `Get-Process -Id`, and `sc queryex` state guidance, drift status tables, routing coverage summaries, security policy summaries, service/log/listening-port PID/process summaries, service-reachability status summaries, failure severity summaries, Activity answer snapshots/assertion details, service-specific DHCP/DNS/log checks, and protocol/policy-specific CLI checks such as OSPF neighbor/interface validation and route-map/prefix-list summaries.
