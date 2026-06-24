# Development Log

## 2026-06-24 KST

- Added Packet Tracer-style Activity Wizard window with Instructions and Check Results tabs.
- Added generated network-device favicon SVG, theme color metadata, and web app manifest wiring.
- Added automatic activity scoring for topology device count, cable endpoint integrity, link state, device power, host IPv4 setup, diagnostics, reachable services, delivered PDU events, and startup-config saves.
- Added project-persisted Activity Wizard instructor requirements for device/link/annotation/PDU/startup-config/service counts with editable Instructions UI, Check Results scoring, sample project coverage, normalize preservation, clone preservation, and project-home search indexing.
- Added Activity Wizard answer topology snapshots with capture/delete UI, device/link/annotation/service/startup-config comparison scoring, normalize preservation, and clone ID remapping.
- Added Activity Wizard per-command startup-config scoring rules with editable Instructions UI, Check Results scoring, normalize preservation, clone ID remapping, and smoke coverage.
- Added Activity Wizard ordered startup-config command sequence scoring with editable Instructions UI, partial scoring, normalize preservation, clone ID remapping, and smoke coverage.
- Added Activity Wizard CLI command output assertions with editable Instructions UI, local CLI engine execution, Check Results scoring, normalize preservation, clone ID remapping, and smoke coverage.
- Added Activity Wizard per-interface expected value rules and packet-header assertions with editable Instructions UI, Check Results scoring, normalize preservation, clone ID remapping, and smoke coverage.
- Added optional Playwright visual smoke harness for Activity Wizard and Simulation dock layout checks.
- Added Activity Check TXT export and menu/toolbar entry points.
- Added Packet Tracer-style workspace notes with canvas placement, drag movement, edit, color cycling, delete, project search indexing, sample project coverage, and import/normalize preservation.
- Added Packet Tracer-style workspace drawing annotations for rectangle zones, ellipse zones, and lines with canvas placement, drag movement, label editing, color cycling, stroke toggling, delete, project search indexing, sample project coverage, import/normalize preservation, and Activity Wizard documentation scoring.
- Added direct corner resize handles and toolbar scale controls for workspace drawing annotations.
- Added keyboard nudging for selected devices, workspace notes, and drawing annotations with Shift+Arrow coarse movement.
- Added freehand workspace drawing annotations with drag-to-draw preview, persisted relative points, normalize preservation, search/minimap support, and resize/drag reuse.
- Added minimap rendering and click-to-jump navigation for workspace notes and drawing annotations alongside devices and links.
- Added Physical workspace backdrop grouping that lists current rack, desktop, and wireless-area devices by label, with powered-off devices visually muted.
- Added Physical workspace auto-arrange command in the View menu, Tools menu, and workspace context menu to place infrastructure devices in the rack, hosts on the desktop table, and wireless devices in the wireless area.
- Added Packet Tracer-style Desktop Terminal app that discovers console-cable targets from PC/server RS232 ports, opens the target device CLI, supports Tab completion and command history, and writes CLI changes back into the project.
- Added smoke coverage for Desktop Terminal console-cable target discovery.
- Added Packet Tracer-style Desktop app buttons and forms for FTP, Email, TFTP, and Syslog while reusing existing simulation events and service logs.
- Added PDU header field rows for Simulation events, CSV export/search coverage, normalize preservation, and protocol-specific inferred headers for older events.
- Added Simulation dock selected-packet scope toggle so capture/playback can focus on one PDU flow.
- Added Physical tab port inspection with selected port state, cable trace, peer endpoint, Layer 1/2/3 details, speed/duplex/MTU, Serial DCE clock hints, explicit shutdown/no shutdown, and explicit cable disconnect.
- Added Physical tab selected-port TDR status and Serial clock quick toggle for faster Layer 1 inspection.
- Added IOS-style cable diagnostics commands for `test cable-diagnostics tdr interface <name>` and `show cable-diagnostics tdr`, including CLI completion/help entries and smoke coverage for open and shutdown copper ports.
- Added Simulation dock cable-list TDR summaries and search indexing so links can be filtered by physical diagnostic terms such as TDR, Normal, Open, Check, Blocked, and Not completed.
- Added TDR summaries to selected-link cards and link context menus for faster cable inspection from the workspace.
- Added Activity Wizard `tdr-normal-count` instructor requirement kind, sample project criteria, normalize preservation, and feature smoke coverage for normal copper TDR link scoring.
- Added Activity Wizard active CLI engine revalidation for command output assertions so Check Results can replace local synchronous output checks with the configured local or remote CLI engine result.
- Updated Activity Check TXT export from the Activity Wizard window to include the currently displayed assessment, including active CLI engine revalidation replacements.
- Added workspace search across devices, models, services, ports, IP settings, links, notes, and drawings with result focusing on the logical canvas.
- Verified `npm run build`, `npm run smoke:features`, and `npm run smoke:cli`.
- Attempted `npm run smoke:visual`; current host is missing Playwright Chromium dependency `libnspr4.so`, and passwordless sudo is unavailable.

### TODO

- Add browser-driven checks for live CLI responses and Activity Wizard active CLI engine output assertion UI.
- Install/CI-provision Playwright Chromium system dependencies and baseline browser visual regression captures.
- Add visual regression coverage for workspace drawing resize/freehand interactions.
- Add browser interaction coverage for Physical tab port inspection, TDR command hints, and explicit cable disconnect flows.

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
- Added runtime log counts to CLI `show services <service>` details with smoke coverage.

### TODO

- Add more Packet Tracer-style PDU fields when packet headers are modeled explicitly.
- Add visual regression or browser smoke tests for Simulation dock layout.
- Expand desktop application commands beyond ping, HTTP, FTP, EMAIL, TFTP, SYSLOG, SSH, TELNET, and current aliases.
