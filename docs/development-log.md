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
- Added DHCP binding CSV export and per-binding release controls in the Services DHCP panel.
- Improved CLI `show ip dhcp binding` with IOS-style headers, lease expiration, binding type, and smoke coverage.
- Added CLI `show ... | count <text>` pipe support and smoke coverage for include, exclude, begin, section, and count filters.
- Added CLI `show vlan summary` plus smoke coverage for VLAN id/name detail lookups.
- Added CLI `show interface <port> switchport` for single-port switchport inspection.
- Added CLI `show interface <port> status` for single-port status inspection.
- Added CLI `show interface <port> counters` for single-port counter inspection.
- Added CLI `show ip dhcp pool <name>` filtering with missing-pool feedback and smoke coverage.
- Added DNS record CSV export in the Services DNS panel.
- Added Services DHCP/DNS duplicate-name validation before creating pools or records.
- Added CLI `show ip dhcp binding <ip|client|mac>` filtering with missing-binding feedback.
- Added CLI `show mac address-table address <mac>` filtering with normalized MAC comparison.
- Added CLI `show arp <ip|mac|interface>` and `show ip arp <ip|mac|interface>` filtering.
- Added CLI `show hosts <name|address>` filtering with missing-host feedback.
- Added Desktop command prompt `ipconfig /flushdns` and `netstat -r` route-table alias.
- Added CLI `show protocols <interface>` filtering for single-interface protocol status.
- Added CLI `show ip route interface <interface>` filtering with compact interface-name matching.
- Added CLI `show ip protocols <protocol>` filtering with missing-protocol feedback.
- Updated README implemented surface summary for service exports, Desktop aliases, and CLI filters.
- Added CLI `show ip route local` filtering for local `/32` routes.
- Added CLI `show ip route gateway <ip>` / `show ip route via <ip>` filtering for static next hops.
- Added CLI `show services enabled|disabled` state filtering.
- Expanded CLI completion hints for newly added filter commands.

### TODO

- Add more Packet Tracer-style PDU fields when packet headers are modeled explicitly.
- Add visual regression or browser smoke tests for Simulation dock layout.
- Expand desktop application commands beyond ping, HTTP, FTP, EMAIL, TFTP, SYSLOG, SSH, TELNET, and current aliases.
