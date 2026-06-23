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
- Improved Cisco-style remote access CLI status output for `show ip ssh`, `show line`, and `show users`.
- Added FTP service support across device services, CLI `service ftp`, Desktop `ftp`, Complex PDU, Simulation filtering, and sample projects.
- Added EMAIL service support across device services, CLI `service email`, Desktop `email`, Complex PDU, Simulation filtering, diagnostics, and smoke tests.
- Added user-created packet protocol filtering, full OSI 1-7 PDU detail rows, and selected PDU CSV export.
- Added link endpoint Config shortcuts, `show services <name>` filtering, URL-scheme-aware Desktop service targets, DHCP release shortcut, and safer DHCP release behavior.
- Added HTTP, FTP, EMAIL, and TFTP service request logs in the Services tab.
- Added per-service log clearing buttons, CLI `clear logging`, and CLI `clear service logs <service>`.
- Added Services tab log search and CSV export for HTTP, FTP, EMAIL, TFTP, and SYSLOG views.
- Added Desktop command help plus `web`/`browser` HTTP aliases and `mail` EMAIL alias.
- Added CLI `show service logs <service>` for filtered HTTP, FTP, EMAIL, TFTP, and SYSLOG runtime logs.
- Expanded Desktop command prompt behavior with `ipconfig /displaydns`, DNS reverse lookup, and bounded `ping -n <count>` replies.

### TODO

- Add more Packet Tracer-style PDU fields when packet headers are modeled explicitly.
- Add visual regression or browser smoke tests for Simulation dock layout.
- Expand desktop application commands beyond ping, HTTP, FTP, EMAIL, TFTP, SYSLOG, SSH, TELNET, and current aliases.
