# Development Log

## 2026-06-23 KST

- Expanded Packet Tracer-like CLI runtime commands for ARP, MAC address table, and DHCP binding cleanup.
- Added runtime table panels for ARP, MAC, DHCP leases, and device logs.
- Improved complex PDU controls with TTL, interval, repeated send behavior, and event annotations.
- Added Simulation event filtering by protocol, status, OSI layer, and search text.
- Added Desktop SSH/Telnet reachability checks and user-created packet rows for SSH/TELNET.
- Added global device power controls and link context actions for shutdown/no shutdown, serial clock quick fix, and VLAN repair.
- Added diagnostics severity/search filtering.
- Added PDU detail tabs for OSI Model, Inbound PDU, and Outbound PDU.
- Added Realtime cable list filtering by status/type and search text.

### TODO

- Add more Packet Tracer-style PDU fields when packet headers are modeled explicitly.
- Add visual regression or browser smoke tests for Simulation dock layout.
- Expand desktop application commands beyond ping, HTTP, TFTP, SYSLOG, SSH, and TELNET.
