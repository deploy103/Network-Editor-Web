import type { CableType, DeviceConfig, DeviceKind, DeviceModel, ModuleSpec, NetworkDevice, NetworkPort, PortKind, PortTemplate } from "../types/network";
import { createId } from "../utils/id";

const routedTabs = ["physical", "config", "cli"] as const;
const hostTabs = ["physical", "config", "desktop"] as const;

export const moduleCatalog: ModuleSpec[] = [
  {
    id: "WIC-1T",
    label: "WIC-1T",
    description: "Legacy 1-port Serial WAN card for 2600/2800 ISR labs.",
    ports: [{ name: "Serial0/{slot}/0", kind: "serial", mode: "routed", ipCapable: true }]
  },
  {
    id: "WIC-2T",
    label: "WIC-2T",
    description: "Legacy 2-port Serial WAN card for ISR labs.",
    ports: [
      { name: "Serial0/{slot}/0", kind: "serial", mode: "routed", ipCapable: true },
      { name: "Serial0/{slot}/1", kind: "serial", mode: "routed", ipCapable: true }
    ]
  },
  {
    id: "HWIC-1T",
    label: "HWIC-1T",
    description: "Single-port serial HWIC for point-to-point WAN links.",
    ports: [{ name: "Serial0/{slot}/0", kind: "serial", mode: "routed", ipCapable: true }]
  },
  {
    id: "HWIC-2T",
    label: "HWIC-2T",
    description: "2-port Serial WAN HWIC for PPP/HDLC labs.",
    ports: [
      { name: "Serial0/{slot}/0", kind: "serial", mode: "routed", ipCapable: true },
      { name: "Serial0/{slot}/1", kind: "serial", mode: "routed", ipCapable: true }
    ]
  },
  {
    id: "HWIC-4T",
    label: "HWIC-4T",
    description: "4-port Serial HWIC for multi-WAN practice.",
    ports: Array.from({ length: 4 }, (_, index) => ({ name: `Serial0/{slot}/${index}`, kind: "serial" as const, mode: "routed" as const, ipCapable: true }))
  },
  {
    id: "VWIC2-2MFT-T1/E1",
    label: "VWIC2-2MFT-T1/E1",
    description: "2-port multiflex trunk voice/WAN card, modeled as serial WAN.",
    ports: [
      { name: "Serial0/{slot}/0:0", kind: "serial", mode: "routed", ipCapable: true },
      { name: "Serial0/{slot}/1:0", kind: "serial", mode: "routed", ipCapable: true }
    ]
  },
  {
    id: "HWIC-1FE",
    label: "HWIC-1FE",
    description: "1-port routed FastEthernet HWIC.",
    ports: [{ name: "FastEthernet0/{slot}/0", kind: "fast-ethernet", mode: "routed", ipCapable: true }]
  },
  {
    id: "HWIC-2FE",
    label: "HWIC-2FE",
    description: "2-port routed FastEthernet HWIC.",
    ports: [
      { name: "FastEthernet0/{slot}/0", kind: "fast-ethernet", mode: "routed", ipCapable: true },
      { name: "FastEthernet0/{slot}/1", kind: "fast-ethernet", mode: "routed", ipCapable: true }
    ]
  },
  {
    id: "HWIC-4ESW",
    label: "HWIC-4ESW",
    description: "4-port FastEthernet EtherSwitch HWIC.",
    ports: Array.from({ length: 4 }, (_, index) => ({ name: `FastEthernet0/{slot}/${index}`, kind: "fast-ethernet" as const, mode: "access" as const, vlan: 1 }))
  },
  {
    id: "HWIC-4ESW-POE",
    label: "HWIC-4ESW-POE",
    description: "4-port FastEthernet EtherSwitch HWIC with PoE behavior modeled as access ports.",
    ports: Array.from({ length: 4 }, (_, index) => ({ name: `FastEthernet0/{slot}/${index}`, kind: "fast-ethernet" as const, mode: "access" as const, vlan: 1 }))
  },
  {
    id: "HWIC-D-9ESW",
    label: "HWIC-D-9ESW",
    description: "9-port FastEthernet EtherSwitch double-wide HWIC.",
    widthSlots: 2,
    ports: Array.from({ length: 9 }, (_, index) => ({ name: `FastEthernet0/{slot}/${index}`, kind: "fast-ethernet" as const, mode: "access" as const, vlan: 1 }))
  },
  {
    id: "HWIC-1GE-SFP",
    label: "HWIC-1GE-SFP",
    description: "1-port routed Gigabit SFP HWIC.",
    ports: [{ name: "GigabitEthernet0/{slot}/0", kind: "fiber", mode: "routed", ipCapable: true }]
  },
  {
    id: "EHWIC-1GE-SFP-CU",
    label: "EHWIC-1GE-SFP-CU",
    description: "Dual-media Gigabit EHWIC, modeled in SFP mode.",
    ports: [{ name: "GigabitEthernet0/{slot}/0", kind: "fiber", mode: "routed", ipCapable: true }]
  },
  {
    id: "EHWIC-4ESG",
    label: "EHWIC-4ESG",
    description: "4-port Gigabit EtherSwitch EHWIC.",
    ports: Array.from({ length: 4 }, (_, index) => ({ name: `GigabitEthernet0/{slot}/${index}`, kind: "gigabit-ethernet" as const, mode: "access" as const, vlan: 1 }))
  },
  {
    id: "EHWIC-8ESG-P",
    label: "EHWIC-8ESG-P",
    description: "8-port Gigabit EtherSwitch EHWIC, PoE modeled as standard access ports.",
    ports: Array.from({ length: 8 }, (_, index) => ({ name: `GigabitEthernet0/{slot}/${index}`, kind: "gigabit-ethernet" as const, mode: "access" as const, vlan: 1 }))
  },
  {
    id: "NIM-2T",
    label: "NIM-2T",
    description: "ISR 4000 2-port Serial Network Interface Module.",
    ports: Array.from({ length: 2 }, (_, index) => ({ name: `Serial0/{slot}/${index}`, kind: "serial" as const, mode: "routed" as const, ipCapable: true }))
  },
  {
    id: "NIM-4T",
    label: "NIM-4T",
    description: "ISR 4000 4-port Serial Network Interface Module.",
    ports: Array.from({ length: 4 }, (_, index) => ({ name: `Serial0/{slot}/${index}`, kind: "serial" as const, mode: "routed" as const, ipCapable: true }))
  },
  {
    id: "NIM-1GE-CU-SFP",
    label: "NIM-1GE-CU-SFP",
    description: "ISR 4000 dual-media routed Gigabit NIM, modeled in SFP mode.",
    ports: [{ name: "GigabitEthernet0/{slot}/0", kind: "fiber", mode: "routed", ipCapable: true }]
  },
  {
    id: "NIM-ES2-4",
    label: "NIM-ES2-4",
    description: "ISR 4000 4-port Layer 2 Gigabit EtherSwitch NIM.",
    ports: Array.from({ length: 4 }, (_, index) => ({ name: `GigabitEthernet0/{slot}/${index}`, kind: "gigabit-ethernet" as const, mode: "access" as const, vlan: 1 }))
  },
  {
    id: "NIM-ES2-8",
    label: "NIM-ES2-8",
    description: "ISR 4000 8-port Layer 2 Gigabit EtherSwitch NIM.",
    ports: Array.from({ length: 8 }, (_, index) => ({ name: `GigabitEthernet0/{slot}/${index}`, kind: "gigabit-ethernet" as const, mode: "access" as const, vlan: 1 }))
  },
  {
    id: "NIM-ES2-4-P",
    label: "NIM-ES2-4-P",
    description: "ISR 4000 4-port PoE EtherSwitch NIM, modeled as Layer 2 Gigabit access ports.",
    ports: Array.from({ length: 4 }, (_, index) => ({ name: `GigabitEthernet0/{slot}/${index}`, kind: "gigabit-ethernet" as const, mode: "access" as const, vlan: 1 }))
  },
  {
    id: "NIM-ES2-8-P",
    label: "NIM-ES2-8-P",
    description: "ISR 4000 8-port PoE EtherSwitch NIM, modeled as Layer 2 Gigabit access ports.",
    ports: Array.from({ length: 8 }, (_, index) => ({ name: `GigabitEthernet0/{slot}/${index}`, kind: "gigabit-ethernet" as const, mode: "access" as const, vlan: 1 }))
  },
  {
    id: "NIM-1MFT-T1/E1",
    label: "NIM-1MFT-T1/E1",
    description: "1-port multiflex trunk voice/clear-channel T1/E1 NIM, modeled as serial.",
    ports: [{ name: "Serial0/{slot}/0:0", kind: "serial", mode: "routed", ipCapable: true }]
  },
  {
    id: "NIM-2MFT-T1/E1",
    label: "NIM-2MFT-T1/E1",
    description: "2-port multiflex trunk voice/clear-channel T1/E1 NIM, modeled as serial.",
    ports: [
      { name: "Serial0/{slot}/0:0", kind: "serial", mode: "routed", ipCapable: true },
      { name: "Serial0/{slot}/1:0", kind: "serial", mode: "routed", ipCapable: true }
    ]
  },
  {
    id: "NIM-4MFT-T1/E1",
    label: "NIM-4MFT-T1/E1",
    description: "4-port multiflex trunk voice/clear-channel T1/E1 NIM, modeled as serial.",
    ports: Array.from({ length: 4 }, (_, index) => ({ name: `Serial0/{slot}/${index}:0`, kind: "serial" as const, mode: "routed" as const, ipCapable: true }))
  },
  {
    id: "NIM-8MFT-T1/E1",
    label: "NIM-8MFT-T1/E1",
    description: "8-port multiflex trunk voice/clear-channel T1/E1 NIM, modeled as serial.",
    ports: Array.from({ length: 8 }, (_, index) => ({ name: `Serial0/{slot}/${index}:0`, kind: "serial" as const, mode: "routed" as const, ipCapable: true }))
  },
  {
    id: "NIM-1CE1T1-PRI",
    label: "NIM-1CE1T1-PRI",
    description: "1-port channelized T1/E1 PRI NIM, modeled as serial WAN.",
    ports: [{ name: "Serial0/{slot}/0:23", kind: "serial", mode: "routed", ipCapable: true }]
  },
  {
    id: "NIM-2CE1T1-PRI",
    label: "NIM-2CE1T1-PRI",
    description: "2-port channelized T1/E1 PRI NIM, modeled as serial WAN.",
    ports: [
      { name: "Serial0/{slot}/0:23", kind: "serial", mode: "routed", ipCapable: true },
      { name: "Serial0/{slot}/1:23", kind: "serial", mode: "routed", ipCapable: true }
    ]
  },
  {
    id: "NIM-2BRI-S/T",
    label: "NIM-2BRI-S/T",
    description: "2-port ISDN BRI S/T NIM, modeled as serial interfaces for lab cabling.",
    ports: [
      { name: "Serial0/{slot}/0", kind: "serial", mode: "routed", ipCapable: true },
      { name: "Serial0/{slot}/1", kind: "serial", mode: "routed", ipCapable: true }
    ]
  },
  {
    id: "NIM-4BRI-S/T",
    label: "NIM-4BRI-S/T",
    description: "4-port ISDN BRI S/T NIM, modeled as serial interfaces for lab cabling.",
    ports: Array.from({ length: 4 }, (_, index) => ({ name: `Serial0/{slot}/${index}`, kind: "serial" as const, mode: "routed" as const, ipCapable: true }))
  },
  {
    id: "NIM-2GE-CU-SFP",
    label: "NIM-2GE-CU-SFP",
    description: "2-port routed Gigabit dual-media NIM, modeled with SFP-capable routed ports.",
    ports: [
      { name: "GigabitEthernet0/{slot}/0", kind: "fiber", mode: "routed", ipCapable: true },
      { name: "GigabitEthernet0/{slot}/1", kind: "fiber", mode: "routed", ipCapable: true }
    ]
  },
  {
    id: "C3850-NM-4-1G",
    label: "C3850-NM-4-1G",
    description: "Catalyst 3850 network module with four 1G SFP uplinks.",
    ports: Array.from({ length: 4 }, (_, index) => ({ name: `GigabitEthernet1/{slot}/${index + 1}`, kind: "fiber" as const, mode: "access" as const, vlan: 1 }))
  },
  {
    id: "C3850-NM-2-10G",
    label: "C3850-NM-2-10G",
    description: "Catalyst 3850 network module with two 1G SFP and two 10G SFP+ uplinks.",
    ports: [
      { name: "GigabitEthernet1/{slot}/1", kind: "fiber", mode: "access", vlan: 1 },
      { name: "GigabitEthernet1/{slot}/2", kind: "fiber", mode: "access", vlan: 1 },
      { name: "TenGigabitEthernet1/{slot}/3", kind: "fiber", mode: "access", vlan: 1 },
      { name: "TenGigabitEthernet1/{slot}/4", kind: "fiber", mode: "access", vlan: 1 }
    ]
  },
  {
    id: "C3850-NM-4-10G",
    label: "C3850-NM-4-10G",
    description: "Catalyst 3850 network module with four 10G SFP+ uplinks.",
    ports: Array.from({ length: 4 }, (_, index) => ({ name: `TenGigabitEthernet1/{slot}/${index + 1}`, kind: "fiber" as const, mode: "access" as const, vlan: 1 }))
  },
  {
    id: "C3850-NM-8-10G",
    label: "C3850-NM-8-10G",
    description: "Catalyst 3850 network module with eight 10G SFP+ uplinks.",
    ports: Array.from({ length: 8 }, (_, index) => ({ name: `TenGigabitEthernet1/{slot}/${index + 1}`, kind: "fiber" as const, mode: "access" as const, vlan: 1 }))
  },
  {
    id: "C3850-NM-2-40G",
    label: "C3850-NM-2-40G",
    description: "Catalyst 3850 network module with two 40G QSFP uplinks, modeled as fiber uplinks.",
    ports: [
      { name: "FortyGigabitEthernet1/{slot}/1", kind: "fiber", mode: "access", vlan: 1 },
      { name: "FortyGigabitEthernet1/{slot}/2", kind: "fiber", mode: "access", vlan: 1 }
    ]
  },
  {
    id: "C9200-NM-4G",
    label: "C9200-NM-4G",
    description: "Catalyst 9200 network module with four 1G SFP uplinks.",
    ports: Array.from({ length: 4 }, (_, index) => ({ name: `GigabitEthernet1/{slot}/${index + 1}`, kind: "fiber" as const, mode: "access" as const, vlan: 1 }))
  },
  {
    id: "C9200-NM-4X",
    label: "C9200-NM-4X",
    description: "Catalyst 9200 network module with four 10G SFP+ uplinks.",
    ports: Array.from({ length: 4 }, (_, index) => ({ name: `TenGigabitEthernet1/{slot}/${index + 1}`, kind: "fiber" as const, mode: "access" as const, vlan: 1 }))
  },
  {
    id: "C9200-NM-2Y",
    label: "C9200-NM-2Y",
    description: "Catalyst 9200 network module with two 25G SFP28 uplinks, modeled as fiber uplinks.",
    ports: Array.from({ length: 2 }, (_, index) => ({ name: `TwentyFiveGigabitEthernet1/{slot}/${index + 1}`, kind: "fiber" as const, mode: "access" as const, vlan: 1 }))
  },
  {
    id: "C9300-NM-4G",
    label: "C9300-NM-4G",
    description: "Catalyst 9300 network module with four 1G SFP uplinks.",
    ports: Array.from({ length: 4 }, (_, index) => ({ name: `GigabitEthernet1/{slot}/${index + 1}`, kind: "fiber" as const, mode: "access" as const, vlan: 1 }))
  },
  {
    id: "C9300-NM-8X",
    label: "C9300-NM-8X",
    description: "Catalyst 9300 network module with eight 10G SFP+ uplinks.",
    ports: Array.from({ length: 8 }, (_, index) => ({ name: `TenGigabitEthernet1/{slot}/${index + 1}`, kind: "fiber" as const, mode: "access" as const, vlan: 1 }))
  },
  {
    id: "C9300-NM-2Q",
    label: "C9300-NM-2Q",
    description: "Catalyst 9300 network module with two 40G QSFP uplinks.",
    ports: Array.from({ length: 2 }, (_, index) => ({ name: `FortyGigabitEthernet1/{slot}/${index + 1}`, kind: "fiber" as const, mode: "access" as const, vlan: 1 }))
  },
  {
    id: "C9300-NM-2Y",
    label: "C9300-NM-2Y",
    description: "Catalyst 9300 network module with two 25G SFP28 uplinks.",
    ports: Array.from({ length: 2 }, (_, index) => ({ name: `TwentyFiveGigabitEthernet1/{slot}/${index + 1}`, kind: "fiber" as const, mode: "access" as const, vlan: 1 }))
  },
  {
    id: "C9300X-NM-8Y",
    label: "C9300X-NM-8Y",
    description: "Catalyst 9300X high-speed network module with eight 25G SFP28 uplinks.",
    ports: Array.from({ length: 8 }, (_, index) => ({ name: `TwentyFiveGigabitEthernet1/{slot}/${index + 1}`, kind: "fiber" as const, mode: "access" as const, vlan: 1 }))
  },
  {
    id: "C9300X-NM-2C",
    label: "C9300X-NM-2C",
    description: "Catalyst 9300X network module with two 100G QSFP28 uplinks.",
    ports: Array.from({ length: 2 }, (_, index) => ({ name: `HundredGigabitEthernet1/{slot}/${index + 1}`, kind: "fiber" as const, mode: "access" as const, vlan: 1 }))
  },
  {
    id: "NM-16ESW",
    label: "NM-16ESW",
    description: "16-port FastEthernet network module.",
    ports: Array.from({ length: 16 }, (_, index) => ({ name: `FastEthernet{slot}/${index}`, kind: "fast-ethernet" as const, mode: "access" as const, vlan: 1 }))
  },
  {
    id: "NME-16ES-1G-P",
    label: "NME-16ES-1G-P",
    description: "16 FastEthernet switchports plus one SFP uplink.",
    ports: [
      ...Array.from({ length: 16 }, (_, index) => ({ name: `FastEthernet{slot}/0/${index}`, kind: "fast-ethernet" as const, mode: "access" as const, vlan: 1 })),
      { name: "GigabitEthernet{slot}/0/0", kind: "fiber", mode: "access", vlan: 1 }
    ]
  },
  {
    id: "SM-ES3-16-P",
    label: "SM-ES3-16-P",
    description: "ISR G2 service-module EtherSwitch with Gigabit access ports.",
    ports: [
      ...Array.from({ length: 16 }, (_, index) => ({ name: `GigabitEthernet{slot}/0/${index}`, kind: "gigabit-ethernet" as const, mode: "access" as const, vlan: 1 })),
      { name: "GigabitEthernet{slot}/1/0", kind: "fiber", mode: "access", vlan: 1 },
      { name: "GigabitEthernet{slot}/1/1", kind: "fiber", mode: "access", vlan: 1 }
    ]
  },
  {
    id: "SM-X-ES3-24-P",
    label: "SM-X-ES3-24-P",
    description: "24-port ISR service-module EtherSwitch, modeled with Gigabit access ports and SFP uplinks.",
    ports: [
      ...Array.from({ length: 24 }, (_, index) => ({ name: `GigabitEthernet{slot}/0/${index + 1}`, kind: "gigabit-ethernet" as const, mode: "access" as const, vlan: 1 })),
      { name: "GigabitEthernet{slot}/1/1", kind: "fiber", mode: "access", vlan: 1 },
      { name: "GigabitEthernet{slot}/1/2", kind: "fiber", mode: "access", vlan: 1 }
    ]
  },
  {
    id: "C3KX-NM-1G",
    label: "C3KX-NM-1G",
    description: "Catalyst 3560-X/3750-X 4x1G SFP network module.",
    ports: Array.from({ length: 4 }, (_, index) => ({ name: `GigabitEthernet1/{slot}/${index + 1}`, kind: "fiber" as const, mode: "access" as const, vlan: 1 }))
  },
  {
    id: "C3KX-NM-10G",
    label: "C3KX-NM-10G",
    description: "Catalyst 3560-X/3750-X 10G module, modeled as fiber uplinks.",
    ports: [
      { name: "TenGigabitEthernet1/{slot}/1", kind: "fiber", mode: "access", vlan: 1 },
      { name: "TenGigabitEthernet1/{slot}/2", kind: "fiber", mode: "access", vlan: 1 }
    ]
  },
  {
    id: "C3KX-NM-10GT",
    label: "C3KX-NM-10GT",
    description: "Catalyst 3560-X/3750-X 2x10GBASE-T network module.",
    ports: [
      { name: "TenGigabitEthernet1/{slot}/1", kind: "gigabit-ethernet", mode: "access", vlan: 1 },
      { name: "TenGigabitEthernet1/{slot}/2", kind: "gigabit-ethernet", mode: "access", vlan: 1 }
    ]
  },
  {
    id: "PT-HOST-NM-1W",
    label: "PT-HOST-NM-1W",
    description: "Wireless host adapter.",
    ports: [{ name: "Wireless0", kind: "wireless", mode: "access", vlan: 1, ipCapable: true }]
  }
];

function fastEthernet(count: number, prefix = "FastEthernet0/", start = 1): PortTemplate[] {
  return Array.from({ length: count }, (_, index) => ({ name: `${prefix}${index + start}`, kind: "fast-ethernet", mode: "access", vlan: 1 }));
}

function ethernet(count: number, prefix = "Ethernet0/", start = 0): PortTemplate[] {
  return Array.from({ length: count }, (_, index) => ({ name: `${prefix}${index + start}`, kind: "ethernet", mode: "access", vlan: 1 }));
}

function gigabit(count: number, prefix = "GigabitEthernet0/", start = 1): PortTemplate[] {
  return Array.from({ length: count }, (_, index) => ({ name: `${prefix}${index + start}`, kind: "gigabit-ethernet", mode: "access", vlan: 1 }));
}

function routedGigabit(count: number, prefix = "GigabitEthernet0/", start = 0): PortTemplate[] {
  return Array.from({ length: count }, (_, index) => ({ name: `${prefix}${index + start}`, kind: "gigabit-ethernet", mode: "routed", ipCapable: true }));
}

function sfp(count: number, prefix = "GigabitEthernet0/", start = 1): PortTemplate[] {
  return Array.from({ length: count }, (_, index) => ({ name: `${prefix}${index + start}`, kind: "fiber", mode: "access", vlan: 1 }));
}

function fiberPorts(count: number, prefix: string, start = 1, mode: PortTemplate["mode"] = "access"): PortTemplate[] {
  return Array.from({ length: count }, (_, index) => ({ name: `${prefix}${index + start}`, kind: "fiber", mode, vlan: mode === "access" ? 1 : undefined, ipCapable: mode === "routed" }));
}

function consolePort(): PortTemplate {
  return { name: "Console0", kind: "console", mode: "access" };
}

function svi(vlan = 1): PortTemplate {
  return { name: `Vlan${vlan}`, kind: "ethernet", mode: "routed", vlan, ipCapable: true };
}

function moduleSlots(count: number, labelPrefix: string, accepts: string[]): DeviceModel["modules"] {
  return Array.from({ length: count }, (_, index) => ({ id: `slot${index}`, label: `${labelPrefix} ${index}`, accepts }));
}

function serviceModuleSlot(index: number, accepts: string[]): DeviceModel["modules"][number] {
  return { id: `slot${index}`, label: `Service Module ${index}`, accepts };
}

const legacyHwicModules = ["WIC-1T", "WIC-2T", "HWIC-1T", "HWIC-2T", "HWIC-4T", "VWIC2-2MFT-T1/E1", "HWIC-1FE", "HWIC-2FE", "HWIC-4ESW", "HWIC-4ESW-POE", "HWIC-D-9ESW", "HWIC-1GE-SFP"];
const ehwicModules = ["WIC-1T", "WIC-2T", "HWIC-1T", "HWIC-2T", "HWIC-4T", "VWIC2-2MFT-T1/E1", "HWIC-1FE", "HWIC-2FE", "HWIC-4ESW", "HWIC-4ESW-POE", "HWIC-D-9ESW", "HWIC-1GE-SFP", "EHWIC-1GE-SFP-CU", "EHWIC-4ESG", "EHWIC-8ESG-P"];
const nimModules = ["NIM-2T", "NIM-4T", "NIM-1GE-CU-SFP", "NIM-2GE-CU-SFP", "NIM-ES2-4", "NIM-ES2-8", "NIM-ES2-4-P", "NIM-ES2-8-P", "NIM-1MFT-T1/E1", "NIM-2MFT-T1/E1", "NIM-4MFT-T1/E1", "NIM-8MFT-T1/E1", "NIM-1CE1T1-PRI", "NIM-2CE1T1-PRI", "NIM-2BRI-S/T", "NIM-4BRI-S/T"];
const compactNimModules = nimModules.filter((moduleId) => !["NIM-4MFT-T1/E1", "NIM-8MFT-T1/E1", "NIM-4BRI-S/T"].includes(moduleId));
const c3850Modules = ["C3850-NM-4-1G", "C3850-NM-2-10G", "C3850-NM-4-10G", "C3850-NM-8-10G", "C3850-NM-2-40G"];
const c9200Modules = ["C9200-NM-4G", "C9200-NM-4X", "C9200-NM-2Y"];
const c9300Modules = ["C9300-NM-4G", "C9300-NM-8X", "C9300-NM-2Q", "C9300-NM-2Y"];
const c9300xModules = ["C9300X-NM-8Y", "C9300X-NM-2C"];

function legacyFastRouter(id: string, model: string, description: string, slots = 2, networkModule = false): DeviceModel {
  return {
    id,
    kind: "router",
    model,
    labelPrefix: "Router",
    description,
    tabs: [...routedTabs],
    ports: [
      { name: "FastEthernet0/0", kind: "fast-ethernet", mode: "routed", ipCapable: true },
      { name: "FastEthernet0/1", kind: "fast-ethernet", mode: "routed", ipCapable: true },
      consolePort()
    ],
    modules: [
      ...moduleSlots(slots, "HWIC", legacyHwicModules),
      ...(networkModule ? [serviceModuleSlot(slots, ["NM-16ESW", "NME-16ES-1G-P"])] : [])
    ],
    softwareVersion: id.includes("1841") ? "12.4(24)T8" : "15.1(4)M12a",
    softwareTrain: id.includes("1841") ? "C1841-ADVENTERPRISEK9-M" : "C2800NM-ADVIPSERVICESK9-M",
    iosImage: id.includes("1841") ? "c1841-adventerprisek9-mz.124-24.T8.bin" : "c2800nm-advipservicesk9-mz.151-4.M12a.bin"
  };
}

function isr1kRouter(id: string, model: string, description: string, lanPorts: number, wanPorts = 2): DeviceModel {
  return {
    id,
    kind: "router",
    model,
    labelPrefix: "Router",
    description,
    tabs: [...routedTabs],
    ports: [
      ...routedGigabit(wanPorts, "GigabitEthernet0/0/"),
      ...gigabit(lanPorts, "GigabitEthernet0/1/", 0),
      consolePort()
    ],
    modules: [],
    softwareVersion: "17.09.05",
    softwareTrain: "ISR1100-UNIVERSALK9",
    iosImage: "c1100-universalk9.17.09.05.SPA.bin"
  };
}

function isrG2Router(id: string, model: string, description: string, slots = 4, serviceModule = false, onboardGigabit = 2): DeviceModel {
  const serviceSlotIndex = slots;
  return {
    id,
    kind: "router",
    model,
    labelPrefix: "Router",
    description,
    tabs: [...routedTabs],
    ports: [...routedGigabit(onboardGigabit), consolePort()],
    modules: [
      ...moduleSlots(slots, "EHWIC", ehwicModules),
      ...(serviceModule ? [serviceModuleSlot(serviceSlotIndex, ["SM-ES3-16-P"])] : [])
    ],
    softwareVersion: "15.2(4)M6",
    softwareTrain: id.includes("1900") || id.includes("1941") ? "C1900-UNIVERSALK9-M" : "C2900-UNIVERSALK9-M",
    iosImage: id.includes("1941") ? "c1900-universalk9-mz.SPA.152-4.M6.bin" : "c2900-universalk9-mz.SPA.152-4.M6.bin"
  };
}

function isr4kRouter(id: string, model: string, description: string, nimSlots = 2, serviceModule = false, onboardGigabit = 2, acceptedNims = nimModules): DeviceModel {
  return {
    id,
    kind: "router",
    model,
    labelPrefix: "Router",
    description,
    tabs: [...routedTabs],
    ports: [...routedGigabit(onboardGigabit, "GigabitEthernet0/0/"), consolePort()],
    modules: [
      ...moduleSlots(nimSlots, "NIM", acceptedNims),
      ...(serviceModule ? [serviceModuleSlot(nimSlots, ["SM-X-ES3-24-P"])] : [])
    ],
    softwareVersion: "16.09.08",
    softwareTrain: "ISR4300-UNIVERSALK9",
    iosImage: "isr4300-universalk9.16.09.08.SPA.bin"
  };
}

function catalyst9200FixedSwitch(id: string, model: string, description: string, accessPorts: number, uplinks: number, uplinkPrefix = "GigabitEthernet1/1/"): DeviceModel {
  return {
    id,
    kind: "switch",
    model,
    labelPrefix: "Switch",
    description,
    tabs: [...routedTabs],
    ports: [...gigabit(accessPorts, "GigabitEthernet1/0/"), ...fiberPorts(uplinks, uplinkPrefix), svi(1), consolePort()],
    modules: [],
    softwareVersion: "17.09.05",
    softwareTrain: "CAT9K_LITE_IOSXE",
    iosImage: "cat9k_lite_iosxe.17.09.05.SPA.bin"
  };
}

function catalyst9200ModularSwitch(id: string, model: string, description: string, accessPorts: number): DeviceModel {
  return {
    id,
    kind: "switch",
    model,
    labelPrefix: "Switch",
    description,
    tabs: [...routedTabs],
    ports: [...gigabit(accessPorts, "GigabitEthernet1/0/"), svi(1), consolePort()],
    modules: [{ id: "slot1", label: "Network Module 1", accepts: c9200Modules }],
    softwareVersion: "17.09.05",
    softwareTrain: "CAT9K_IOSXE",
    iosImage: "cat9k_iosxe.17.09.05.SPA.bin"
  };
}

function catalyst9300Switch(id: string, model: string, description: string, accessPorts: number, moduleAccepts = c9300Modules, multigigabit = false): DeviceModel {
  const prefix = multigigabit ? "TenGigabitEthernet1/0/" : "GigabitEthernet1/0/";
  return {
    id,
    kind: "switch",
    model,
    labelPrefix: "Switch",
    description,
    tabs: [...routedTabs],
    ports: [...gigabit(accessPorts, prefix), svi(1), consolePort()],
    modules: [{ id: "slot1", label: "Network Module 1", accepts: moduleAccepts }],
    softwareVersion: "17.09.05",
    softwareTrain: "CAT9K_IOSXE",
    iosImage: "cat9k_iosxe.17.09.05.SPA.bin"
  };
}

function catalyst9500Switch(id: string, model: string, description: string, portCount: number, portPrefix: string): DeviceModel {
  return {
    id,
    kind: "switch",
    model,
    labelPrefix: "DistSwitch",
    description,
    tabs: [...routedTabs],
    ports: [...fiberPorts(portCount, portPrefix, 1, "routed"), svi(1), consolePort()],
    modules: [],
    softwareVersion: "17.09.05",
    softwareTrain: "CAT9K_IOSXE",
    iosImage: "cat9k_iosxe.17.09.05.SPA.bin"
  };
}

function catalyst3850Switch(id: string, model: string, description: string, accessPorts: number, moduleAccepts = c3850Modules): DeviceModel {
  return {
    id,
    kind: "switch",
    model,
    labelPrefix: "Switch",
    description,
    tabs: [...routedTabs],
    ports: [...gigabit(accessPorts, "GigabitEthernet1/0/"), svi(1), consolePort()],
    modules: [{ id: "slot1", label: "Network Module 1", accepts: moduleAccepts }],
    softwareVersion: "16.12.10a",
    softwareTrain: "CAT3K_CAA-UNIVERSALK9",
    iosImage: "cat3k_caa-universalk9.16.12.10a.SPA.bin"
  };
}

function asaFirewall(id: string, model: string, description: string, ethernetPorts: number, gigabitPorts = 0): DeviceModel {
  return {
    id,
    kind: "firewall",
    model,
    labelPrefix: "Firewall",
    description,
    tabs: [...routedTabs],
    ports: [...gigabit(gigabitPorts, "GigabitEthernet1/"), ...ethernet(ethernetPorts, "Ethernet0/"), svi(1), svi(2), consolePort()],
    modules: [],
    softwareVersion: "9.16(4)",
    softwareTrain: "ASA",
    iosImage: "asa9-16-4-lfbff-k8.SPA"
  };
}

function firepowerFirewall(id: string, model: string, description: string, ports: number): DeviceModel {
  return {
    id,
    kind: "firewall",
    model,
    labelPrefix: "Firewall",
    description,
    tabs: [...routedTabs],
    ports: [...gigabit(ports, "Ethernet1/"), svi(1), svi(2), consolePort()],
    modules: [],
    softwareVersion: "7.2.5",
    softwareTrain: "FTD",
    iosImage: "ftd-7.2.5"
  };
}

function accessPoint(id: string, model: string, description: string, ethernetKind: PortKind = "gigabit-ethernet"): DeviceModel {
  return {
    id,
    kind: "wireless",
    model,
    labelPrefix: "AP",
    description,
    tabs: ["physical", "config"],
    ports: [
      { name: "GigabitEthernet0", kind: ethernetKind, mode: "access", vlan: 1, ipCapable: true },
      { name: "Wireless0", kind: "wireless", mode: "access", vlan: 1, ipCapable: true },
      consolePort()
    ],
    modules: [],
    softwareVersion: "17.9.4",
    softwareTrain: "C9800-AP",
    iosImage: "ap3g3-k9w8-tar.17.9.4.tar"
  };
}

function wirelessController(id: string, model: string, description: string, ports: PortTemplate[]): DeviceModel {
  return {
    id,
    kind: "wireless",
    model,
    labelPrefix: "WLC",
    description,
    tabs: ["physical", "config", "services"],
    ports: [...ports, consolePort()],
    modules: [],
    softwareVersion: "17.09.04",
    softwareTrain: "C9800-CL",
    iosImage: "C9800-CL-universalk9.17.09.04.iso"
  };
}

export const deviceCatalog: DeviceModel[] = [
  legacyFastRouter("router-1841", "Cisco 1841 ISR", "2x FastEthernet, 2 HWIC slots, IOS 12.4T.", 2),
  legacyFastRouter("router-2621xm", "Cisco 2621XM", "Legacy modular router with 2 FastEthernet, WIC, and NM expansion.", 2, true),
  isrG2Router("router-1941", "Cisco 1941 ISR G2", "2x GigabitEthernet, 2 EHWIC slots, IOS 15.2M.", 2),
  legacyFastRouter("router-2811", "Cisco 2811 ISR", "FastEthernet ISR with HWIC and NM expansion.", 4, true),
  isrG2Router("router-3825", "Cisco 3825 ISR", "Gigabit ISR with HWIC and network-module expansion for WAN labs.", 4, true, 2),
  isrG2Router("router-2901", "Cisco 2901 ISR G2", "Gigabit ISR G2 with 4 EHWIC slots.", 4, false),
  isrG2Router("router-2911", "Cisco 2911 ISR G2", "ISR G2 platform with 3 GE, 4 EHWIC plus service module slot.", 4, true, 3),
  isr4kRouter("router-4221", "Cisco ISR 4221", "Compact IOS XE branch router with GE WAN/LAN and NIM expansion.", 2, false, 2, compactNimModules),
  isr4kRouter("router-4321", "Cisco ISR 4321", "IOS XE branch router with 2 routed GE ports and NIM expansion.", 2, false, 2, compactNimModules),
  isr4kRouter("router-4331", "Cisco ISR 4331", "IOS XE branch router with 3 routed GE ports, NIM slots, and service-module expansion.", 3, true, 3),
  isr4kRouter("router-4351", "Cisco ISR 4351", "Modular IOS XE branch router with 3 GE ports, NIM slots, and service-module expansion.", 3, true, 3),
  isr4kRouter("router-4431", "Cisco ISR 4431", "Higher-throughput ISR 4000 platform with NIM and service-module expansion.", 3, true, 4),
  isr4kRouter("router-4451", "Cisco ISR 4451-X", "High-performance ISR 4000 platform with multiple routed GE ports and modular NIM/SM expansion.", 3, true, 4),
  isr1kRouter("router-c1111-4p", "Cisco ISR C1111-4P", "Compact IOS XE branch router with integrated Gigabit WAN and 4-port LAN switch.", 4, 2),
  isr1kRouter("router-c1111-8p", "Cisco ISR C1111-8P", "Compact IOS XE branch router with integrated Gigabit WAN and 8-port LAN switch.", 8, 2),
  isr1kRouter("router-c1121-4p", "Cisco ISR C1121-4P", "ISR 1100 platform router with dual WAN and 4 integrated LAN ports.", 4, 2),
  isr1kRouter("router-c1161x-8p", "Cisco ISR C1161X-8P", "ISR 1100X branch router with dual WAN, 8-port LAN switch, and IOS XE security features.", 8, 2),
  {
    id: "router-asr1001x",
    kind: "router",
    model: "Cisco ASR 1001-X",
    labelPrefix: "EdgeRouter",
    description: "Aggregation Services Router with routed GE and 10G uplinks for WAN edge labs.",
    tabs: [...routedTabs],
    ports: [
      ...routedGigabit(6, "GigabitEthernet0/0/"),
      ...fiberPorts(2, "TenGigabitEthernet0/1/", 0, "routed"),
      consolePort()
    ],
    modules: [],
    softwareVersion: "17.03.08",
    softwareTrain: "ASR1000-UNIVERSALK9",
    iosImage: "asr1001x-universalk9.17.03.08.SPA.bin"
  },
  {
    id: "router-csr1000v",
    kind: "router",
    model: "Cisco CSR 1000V",
    labelPrefix: "vRouter",
    description: "Virtual IOS XE router with four routed Gigabit interfaces for cloud and WAN simulation.",
    tabs: [...routedTabs],
    ports: [...routedGigabit(4, "GigabitEthernet"), consolePort()],
    modules: [],
    softwareVersion: "17.09.05",
    softwareTrain: "CSR1000V-UNIVERSALK9",
    iosImage: "csr1000v-universalk9.17.09.05.iso"
  },
  {
    id: "switch-2950t-24",
    kind: "switch",
    model: "Catalyst 2950T-24",
    labelPrefix: "Switch",
    description: "Legacy Layer 2 access switch: 24 FE + 2 copper GE uplinks.",
    tabs: [...routedTabs],
    ports: [...fastEthernet(24), ...gigabit(2, "GigabitEthernet0/"), consolePort()],
    modules: [],
    softwareVersion: "12.1(22)EA14",
    softwareTrain: "C2950-I6Q4L2-M",
    iosImage: "c2950-i6q4l2-mz.121-22.EA14.bin"
  },
  {
    id: "switch-2960-24tt",
    kind: "switch",
    model: "Catalyst 2960-24TT-L",
    labelPrefix: "Switch",
    description: "Fixed Layer 2 access switch: 24 FE + 2 copper GE uplinks.",
    tabs: [...routedTabs],
    ports: [...fastEthernet(24), ...gigabit(2), consolePort()],
    modules: [],
    softwareVersion: "15.0(2)SE4",
    softwareTrain: "C2960-LANBASEK9-M",
    iosImage: "c2960-lanbasek9-mz.150-2.SE4.bin"
  },
  {
    id: "switch-2960-48tt",
    kind: "switch",
    model: "Catalyst 2960-48TT-L",
    labelPrefix: "Switch",
    description: "Fixed Layer 2 access switch: 48 FE + 2 copper GE uplinks.",
    tabs: [...routedTabs],
    ports: [...fastEthernet(48), ...gigabit(2), consolePort()],
    modules: [],
    softwareVersion: "15.0(2)SE4",
    softwareTrain: "C2960-LANBASEK9-M",
    iosImage: "c2960-lanbasek9-mz.150-2.SE4.bin"
  },
  {
    id: "switch-2960-24tc",
    kind: "switch",
    model: "Catalyst 2960-24TC-L",
    labelPrefix: "Switch",
    description: "Fixed access switch: 24 FE + 2 dual-purpose copper/SFP uplinks, modeled in SFP mode.",
    tabs: [...routedTabs],
    ports: [...fastEthernet(24), ...sfp(2), consolePort()],
    modules: [],
    softwareVersion: "15.0(2)SE4",
    softwareTrain: "C2960-LANBASEK9-M",
    iosImage: "c2960-lanbasek9-mz.150-2.SE4.bin"
  },
  {
    id: "switch-2960x-24ps",
    kind: "switch",
    model: "Catalyst 2960X-24PS-L",
    labelPrefix: "Switch",
    description: "Gigabit access switch with 24 PoE+ ports and 4 SFP uplinks.",
    tabs: [...routedTabs],
    ports: [...gigabit(24), ...sfp(4, "GigabitEthernet0/", 25), consolePort()],
    modules: [],
    softwareVersion: "15.2(7)E9",
    softwareTrain: "C2960X-UNIVERSALK9-M",
    iosImage: "c2960x-universalk9-mz.152-7.E9.bin"
  },
  {
    id: "switch-2960x-48lps",
    kind: "switch",
    model: "Catalyst 2960X-48LPS-L",
    labelPrefix: "Switch",
    description: "Gigabit access switch with 48 PoE-capable ports and 4 SFP uplinks.",
    tabs: [...routedTabs],
    ports: [...gigabit(48), ...sfp(4, "GigabitEthernet0/", 49), consolePort()],
    modules: [],
    softwareVersion: "15.2(7)E9",
    softwareTrain: "C2960X-UNIVERSALK9-M",
    iosImage: "c2960x-universalk9-mz.152-7.E9.bin"
  },
  {
    id: "switch-2960g-24tc",
    kind: "switch",
    model: "Catalyst 2960G-24TC-L",
    labelPrefix: "Switch",
    description: "Fixed Gigabit access switch: 20 GE + 4 SFP uplinks.",
    tabs: [...routedTabs],
    ports: [...gigabit(20), ...sfp(4, "GigabitEthernet0/", 21), consolePort()],
    modules: [],
    softwareVersion: "15.0(2)SE4",
    softwareTrain: "C2960-LANBASEK9-M",
    iosImage: "c2960-lanbasek9-mz.150-2.SE4.bin"
  },
  {
    id: "switch-3560-24ps",
    kind: "switch",
    model: "Catalyst 3560-24PS",
    labelPrefix: "Switch",
    description: "Multilayer fixed switch with FE access and 2 SFP uplinks.",
    tabs: [...routedTabs],
    ports: [...fastEthernet(24), ...sfp(2), svi(1), consolePort()],
    modules: [],
    softwareVersion: "15.0(2)SE4",
    softwareTrain: "C3560-IPSERVICESK9-M",
    iosImage: "c3560-ipservicesk9-mz.150-2.SE4.bin"
  },
  {
    id: "switch-3560g-24ps",
    kind: "switch",
    model: "Catalyst 3560G-24PS",
    labelPrefix: "Switch",
    description: "Gigabit multilayer access switch with 24 PoE ports and 4 SFP uplinks.",
    tabs: [...routedTabs],
    ports: [...gigabit(24), ...sfp(4, "GigabitEthernet0/", 25), svi(1), consolePort()],
    modules: [],
    softwareVersion: "15.0(2)SE4",
    softwareTrain: "C3560-IPSERVICESK9-M",
    iosImage: "c3560-ipservicesk9-mz.150-2.SE4.bin"
  },
  {
    id: "switch-3560x-24t",
    kind: "switch",
    model: "Catalyst 3560X-24T",
    labelPrefix: "Switch",
    description: "Gigabit multilayer switch with optional C3KX network module.",
    tabs: [...routedTabs],
    ports: [...gigabit(24, "GigabitEthernet1/0/"), svi(1), consolePort()],
    modules: [{ id: "slot1", label: "Network Module 1", accepts: ["C3KX-NM-1G", "C3KX-NM-10G", "C3KX-NM-10GT"] }],
    softwareVersion: "15.2(4)E10",
    softwareTrain: "C3560E-UNIVERSALK9-M",
    iosImage: "c3560e-universalk9-mz.152-4.E10.bin"
  },
  {
    id: "switch-3750x-24t",
    kind: "switch",
    model: "Catalyst 3750X-24T",
    labelPrefix: "Switch",
    description: "Stackable multilayer Gigabit switch with optional C3KX network module.",
    tabs: [...routedTabs],
    ports: [...gigabit(24, "GigabitEthernet1/0/"), svi(1), consolePort()],
    modules: [{ id: "slot1", label: "Network Module 1", accepts: ["C3KX-NM-1G", "C3KX-NM-10G", "C3KX-NM-10GT"] }],
    softwareVersion: "15.2(4)E10",
    softwareTrain: "C3750E-UNIVERSALK9-M",
    iosImage: "c3750e-universalk9-mz.152-4.E10.bin"
  },
  catalyst3850Switch("switch-3850-24t", "Catalyst 3850-24T", "IOS XE stackable multilayer switch with 24 Gigabit access ports and a field-replaceable network module slot.", 24),
  catalyst3850Switch("switch-3850-24p", "Catalyst 3850-24P", "IOS XE stackable multilayer switch with 24 PoE+ Gigabit ports and modular uplinks.", 24),
  catalyst3850Switch("switch-3850-48t", "Catalyst 3850-48T", "IOS XE stackable multilayer switch with 48 Gigabit access ports and modular uplinks.", 48),
  catalyst3850Switch("switch-3850-48p", "Catalyst 3850-48P", "IOS XE stackable multilayer switch with 48 PoE+ Gigabit ports and modular uplinks.", 48),
  catalyst3850Switch("switch-3850-24u", "Catalyst 3850-24U", "IOS XE Universal PoE/multigigabit campus switch with modular uplinks.", 24, ["C3850-NM-4-10G", "C3850-NM-8-10G", "C3850-NM-2-40G"]),
  {
    id: "switch-3650-24ps",
    kind: "switch",
    model: "Catalyst 3650-24PS",
    labelPrefix: "Switch",
    description: "IOS XE multilayer access switch with 24 PoE+ ports and 4 SFP uplinks.",
    tabs: [...routedTabs],
    ports: [...gigabit(24, "GigabitEthernet1/0/"), ...sfp(4, "GigabitEthernet1/1/"), svi(1), consolePort()],
    modules: [],
    softwareVersion: "16.12.10a",
    softwareTrain: "CAT3K_CAA-UNIVERSALK9",
    iosImage: "cat3k_caa-universalk9.16.12.10a.SPA.bin"
  },
  catalyst9200FixedSwitch("switch-9200l-24t-4g", "Catalyst 9200L-24T-4G", "Fixed IOS XE access switch with 24 Gigabit data ports and four fixed 1G SFP uplinks.", 24, 4),
  catalyst9200FixedSwitch("switch-9200l-24p-4g", "Catalyst 9200L-24P-4G", "Fixed IOS XE access switch with 24 PoE+ Gigabit ports and four fixed 1G SFP uplinks.", 24, 4),
  catalyst9200FixedSwitch("switch-9200l-48t-4g", "Catalyst 9200L-48T-4G", "Fixed IOS XE access switch with 48 Gigabit data ports and four fixed 1G SFP uplinks.", 48, 4),
  catalyst9200FixedSwitch("switch-9200l-48p-4g", "Catalyst 9200L-48P-4G", "Fixed IOS XE access switch with 48 PoE+ Gigabit ports and four fixed 1G SFP uplinks.", 48, 4),
  catalyst9200FixedSwitch("switch-9200l-24t-4x", "Catalyst 9200L-24T-4X", "Fixed IOS XE access switch with 24 Gigabit data ports and four fixed 10G SFP+ uplinks.", 24, 4, "TenGigabitEthernet1/1/"),
  catalyst9200FixedSwitch("switch-9200l-48p-4x", "Catalyst 9200L-48P-4X", "Fixed IOS XE access switch with 48 PoE+ Gigabit ports and four fixed 10G SFP+ uplinks.", 48, 4, "TenGigabitEthernet1/1/"),
  catalyst9200ModularSwitch("switch-9200-24t", "Catalyst 9200-24T", "Modular IOS XE access switch with 24 Gigabit data ports and a field-replaceable network module slot.", 24),
  catalyst9200ModularSwitch("switch-9200-24p", "Catalyst 9200-24P", "Modular IOS XE access switch with 24 PoE+ Gigabit ports and network module uplinks.", 24),
  catalyst9200ModularSwitch("switch-9200-48t", "Catalyst 9200-48T", "Modular IOS XE access switch with 48 Gigabit data ports and network module uplinks.", 48),
  catalyst9200ModularSwitch("switch-9200-48p", "Catalyst 9200-48P", "Modular IOS XE access switch with 48 PoE+ Gigabit ports and network module uplinks.", 48),
  catalyst9300Switch("switch-9300-24t", "Catalyst 9300-24T", "Stackable IOS XE campus switch with 24 Gigabit data ports and modular uplinks.", 24),
  catalyst9300Switch("switch-9300-24p", "Catalyst 9300-24P", "Stackable IOS XE campus switch with 24 PoE+ Gigabit ports and modular uplinks.", 24),
  catalyst9300Switch("switch-9300-48t", "Catalyst 9300-48T", "Stackable IOS XE campus switch with 48 Gigabit data ports and modular uplinks.", 48),
  catalyst9300Switch("switch-9300-48p", "Catalyst 9300-48P", "Stackable IOS XE campus switch with 48 PoE+ Gigabit ports and modular uplinks.", 48),
  catalyst9300Switch("switch-9300-48u", "Catalyst 9300-48U", "Stackable IOS XE campus switch with 48 UPOE Gigabit ports and modular uplinks.", 48),
  catalyst9300Switch("switch-9300-24ux", "Catalyst 9300-24UX", "Stackable IOS XE campus switch with 24 multigigabit access ports and modular uplinks.", 24, c9300Modules, true),
  catalyst9300Switch("switch-9300-48uxm", "Catalyst 9300-48UXM", "Stackable IOS XE campus switch with 48 mixed multigigabit access ports and modular uplinks.", 48, c9300Modules, true),
  catalyst9300Switch("switch-9300x-24y", "Catalyst 9300X-24Y", "High-performance campus switch with 24 25G fiber access/uplink ports and high-speed modular uplinks.", 24, c9300xModules),
  catalyst9300Switch("switch-9300x-48hx", "Catalyst 9300X-48HX", "High-density UPOE+ multigigabit campus switch with high-speed uplink module support.", 48, c9300xModules, true),
  catalyst9500Switch("switch-9500-16x", "Catalyst 9500-16X", "Fixed core/distribution switch with 16 routed 10G SFP+ ports.", 16, "TenGigabitEthernet1/0/"),
  catalyst9500Switch("switch-9500-24y4c", "Catalyst 9500-24Y4C", "Fixed core/distribution switch with 24 routed 25G SFP28 ports and 100G-class uplinks modeled as fiber.", 28, "TwentyFiveGigabitEthernet1/0/"),
  catalyst9500Switch("switch-9500-32c", "Catalyst 9500-32C", "Fixed core/distribution switch with 32 routed 100G QSFP28 ports modeled as fiber.", 32, "HundredGigabitEthernet1/0/"),
  catalyst9500Switch("switch-9500-48y4c", "Catalyst 9500-48Y4C", "Fixed core/distribution switch with 48 routed 25G SFP28 ports and high-speed uplinks modeled as fiber.", 52, "TwentyFiveGigabitEthernet1/0/"),
  {
    id: "firewall-asa5505",
    kind: "firewall",
    model: "ASA 5505",
    labelPrefix: "Firewall",
    description: "ASA firewall with VLAN interfaces, ACL, and NAT.",
    tabs: [...routedTabs],
    ports: [...fastEthernet(8, "Ethernet0/", 0), svi(1), svi(2), consolePort()],
    modules: [],
    softwareVersion: "9.1(7)",
    softwareTrain: "ASA",
    iosImage: "asa917-k8.bin"
  },
  asaFirewall("firewall-asa5506x", "ASA 5506-X", "ASA-X branch firewall with routed Gigabit interfaces, ACL, NAT, and security policy simulation.", 0, 8),
  asaFirewall("firewall-asa5516x", "ASA 5516-X", "Midrange ASA-X firewall with routed Gigabit interfaces for edge security labs.", 0, 8),
  asaFirewall("firewall-asa5525x", "ASA 5525-X", "Datacenter ASA-X firewall model with routed Gigabit interfaces and VLAN subinterface labs.", 0, 8),
  firepowerFirewall("firewall-fpr1010", "Firepower 1010", "Small-office firewall appliance with eight Ethernet interfaces modeled for routed security zones.", 8),
  firepowerFirewall("firewall-fpr1120", "Firepower 1120", "Branch firewall appliance with routed Ethernet interfaces for NAT, ACL, and segmentation labs.", 8),
  firepowerFirewall("firewall-fpr1140", "Firepower 1140", "Higher-throughput Firepower appliance with routed Ethernet interfaces for campus edge labs.", 8),
  {
    id: "pc-pt",
    kind: "pc",
    model: "PC-PT",
    labelPrefix: "PC",
    description: "Desktop host with Ethernet, command prompt, and RS232.",
    tabs: [...hostTabs],
    ports: [{ name: "FastEthernet0", kind: "fast-ethernet", mode: "access", vlan: 1, ipCapable: true }, { name: "RS232", kind: "console", mode: "access" }],
    modules: [{ id: "slot0", label: "Host adapter", accepts: ["PT-HOST-NM-1W"] }]
  },
  {
    id: "laptop-pt",
    kind: "pc",
    model: "Laptop-PT",
    labelPrefix: "Laptop",
    description: "Portable host with Ethernet, wireless, and command prompt.",
    tabs: [...hostTabs],
    ports: [{ name: "FastEthernet0", kind: "fast-ethernet", mode: "access", vlan: 1, ipCapable: true }, { name: "Wireless0", kind: "wireless", mode: "access", vlan: 1, ipCapable: true }, { name: "RS232", kind: "console", mode: "access" }],
    modules: []
  },
  {
    id: "server-pt",
    kind: "server",
    model: "Server-PT",
    labelPrefix: "Server",
    description: "Server for HTTP, FTP, EMAIL, DHCP, DNS, TFTP, SYSLOG.",
    tabs: ["physical", "config", "desktop", "services"],
    ports: [{ name: "FastEthernet0", kind: "fast-ethernet", mode: "access", vlan: 1, ipCapable: true }],
    modules: []
  },
  {
    id: "ap-pt",
    kind: "wireless",
    model: "Access Point-PT",
    labelPrefix: "AP",
    description: "Bridge between wired Ethernet and wireless clients.",
    tabs: ["physical", "config"],
    ports: [{ name: "FastEthernet0", kind: "fast-ethernet", mode: "access", vlan: 1 }, { name: "Wireless0", kind: "wireless", mode: "access", vlan: 1 }],
    modules: []
  },
  accessPoint("ap-aironet-2802i", "Aironet 2802I", "802.11ac Wave 2 access point with Gigabit Ethernet uplink and CAPWAP-style wireless client bridge modeling."),
  accessPoint("ap-aironet-3802i", "Aironet 3802I", "High-density 802.11ac Wave 2 access point with Gigabit uplink and wireless client bridge modeling."),
  accessPoint("ap-catalyst-9115axi", "Catalyst 9115AXI", "Wi-Fi 6 indoor access point with Gigabit Ethernet uplink and controller-based wireless modeling."),
  accessPoint("ap-catalyst-9120axi", "Catalyst 9120AXI", "Wi-Fi 6 indoor access point with mGig-class uplink modeled as Gigabit Ethernet for copper cabling."),
  accessPoint("ap-catalyst-9130axi", "Catalyst 9130AXI", "High-density Wi-Fi 6 access point with controller-based WLAN behavior modeled through wireless ports."),
  {
    id: "wrt300n",
    kind: "wireless",
    model: "Wireless Router WRT300N",
    labelPrefix: "WRouter",
    description: "Wireless router with Internet uplink and 4 LAN ports.",
    tabs: ["physical", "config", "services"],
    ports: [
      { name: "Internet", kind: "gigabit-ethernet", mode: "routed", vlan: 1, ipCapable: true },
      ...ethernet(4, "Ethernet", 1),
      { name: "Wireless0", kind: "wireless", mode: "access", vlan: 1, ipCapable: true }
    ],
    modules: []
  },
  wirelessController("wlc-2504", "Cisco 2504 WLC", "Legacy wireless LAN controller with management and service-port interfaces for lightweight AP labs.", [
    { name: "GigabitEthernet0", kind: "gigabit-ethernet", mode: "routed", ipCapable: true },
    { name: "GigabitEthernet1", kind: "gigabit-ethernet", mode: "routed", ipCapable: true },
    { name: "ServicePort", kind: "gigabit-ethernet", mode: "routed", ipCapable: true }
  ]),
  wirelessController("wlc-3504", "Cisco 3504 WLC", "Wireless LAN controller with management, redundancy, and service interfaces for campus WLAN labs.", [
    { name: "GigabitEthernet0", kind: "gigabit-ethernet", mode: "routed", ipCapable: true },
    { name: "GigabitEthernet1", kind: "gigabit-ethernet", mode: "routed", ipCapable: true },
    { name: "RedundancyPort", kind: "gigabit-ethernet", mode: "routed", ipCapable: true },
    { name: "ServicePort", kind: "gigabit-ethernet", mode: "routed", ipCapable: true }
  ]),
  wirelessController("wlc-9800-l", "Catalyst 9800-L WLC", "IOS XE wireless controller with routed management and high-availability interfaces.", [
    { name: "TenGigabitEthernet0/0/0", kind: "fiber", mode: "routed", ipCapable: true },
    { name: "TenGigabitEthernet0/0/1", kind: "fiber", mode: "routed", ipCapable: true },
    { name: "GigabitEthernet0", kind: "gigabit-ethernet", mode: "routed", ipCapable: true }
  ]),
  {
    id: "hub-pt",
    kind: "hub",
    model: "Hub-PT",
    labelPrefix: "Hub",
    description: "Layer 1 repeater hub.",
    tabs: ["physical", "config"],
    ports: fastEthernet(8, "Port", 1),
    modules: []
  }
];

export const cableCatalog: Array<{ type: CableType; label: string }> = [
  { type: "auto", label: "자동" },
  { type: "console", label: "콘솔" },
  { type: "copper-straight", label: "구리 직결" },
  { type: "copper-cross", label: "구리 크로스" },
  { type: "fiber", label: "광케이블" },
  { type: "serial-dce", label: "Serial DCE" },
  { type: "serial-dte", label: "Serial DTE" },
  { type: "wireless", label: "무선" }
];

const legacyModelAliases = new Map([
  ["switch-2960", "switch-2960-24tt"],
  ["switch-3560", "switch-3560-24ps"]
]);

function findDeviceModel(modelId: string): DeviceModel | undefined {
  return deviceCatalog.find((item) => item.id === modelId) ?? deviceCatalog.find((item) => item.id === legacyModelAliases.get(modelId));
}

export function createDevice(modelId: string, position: { x: number; y: number }, existing: NetworkDevice[]): NetworkDevice {
  const model = findDeviceModel(modelId);
  if (!model) throw new Error(`Unknown model ${modelId}`);
  const label = nextDeviceLabel(model.labelPrefix, existing);
  const ports = model.ports.map((port, index) => createPort(port, index));
  const config = defaultConfig(label, model.kind);
  if (ports.some((port) => port.kind === "wireless") && !config.wireless.ssid) {
    config.wireless = { ...config.wireless, ssid: "Lab-Wireless" };
  }
  return {
    id: createId("dev"),
    kind: model.kind,
    modelId: model.id,
    model: model.model,
    label,
    position,
    powerOn: true,
    ports,
    modules: [],
    config,
    runtime: { arpTable: [], macTable: [], dhcpLeases: [], natTranslations: [], logs: [] }
  };
}

function nextDeviceLabel(prefix: string, existing: NetworkDevice[]): string {
  const used = new Set(existing.map((device) => device.label));
  let index = 0;
  while (used.has(`${prefix}${index}`)) index += 1;
  return `${prefix}${index}`;
}

export function createPort(template: PortTemplate, index: number, moduleMeta?: { slotId: string; moduleId: string; existingNames: Set<string> }): NetworkPort {
  const name = moduleMeta ? uniquePortName(moduleMeta.existingNames, modulePortName(template.name, moduleMeta.slotId)) : template.name;
  moduleMeta?.existingNames.add(name);
  return {
    id: createId("port"),
    name,
    kind: template.kind,
    description: "",
    macAddress: createMac(index),
    mode: template.mode,
    vlan: template.vlan ?? 1,
    allowedVlans: [1],
    nativeVlan: 1,
    ipAddress: "",
    subnetMask: "",
    secondaryIpAddresses: [],
    gateway: "",
    dnsServer: "",
    adminUp: true,
    ipCapable: Boolean(template.ipCapable || template.mode === "routed"),
    stpPortfast: false,
    bpduGuard: false,
    stpCost: undefined,
    stpPriority: undefined,
    cdpEnabled: true,
    lldpTransmit: false,
    lldpReceive: false,
    dhcpSnoopingTrusted: false,
    dhcpSnoopingRateLimit: undefined,
    voiceVlan: undefined,
    portSecurity: { enabled: false, maximum: 1, violation: "shutdown", sticky: false, secureMacAddresses: [] },
    channelGroup: undefined,
    accessGroupIn: "",
    accessGroupOut: "",
    natRole: undefined,
    hsrpGroups: [],
    vrrpGroups: [],
    moduleSlotId: moduleMeta?.slotId,
    moduleId: moduleMeta?.moduleId,
    duplex: "auto",
    speed: "auto",
    mtu: 1500,
    bandwidth: undefined
  };
}

export function defaultConfig(hostname: string, kind: DeviceKind): DeviceConfig {
  return {
    hostname,
    startupConfig: [],
    domainLookup: true,
    domainName: undefined,
    sshVersion: "2",
    rsaKeyGenerated: false,
    passwordEncryption: false,
    logging: { console: true, buffered: true, hosts: [], trap: "informational" },
    lineConfigs: [],
    routingProtocols: [],
    staticRoutes: [],
    vlans: [{ id: 1, name: "default" }],
    dhcpPools: [],
    dhcpExcludedRanges: [],
    dnsRecords: kind === "server" ? [{ id: createId("dns"), name: "www.lab.local", value: "192.168.1.10" }] : [],
    nameServers: [],
    accessRules: [],
    natRules: [],
    prefixLists: [],
    routeMaps: [],
    ipSlaOperations: [],
    trackObjects: [],
    stpRootPrimaryVlans: [],
    stpRootSecondaryVlans: [],
    stpMode: "pvst",
    errdisableRecovery: { bpduguard: false, interval: 300 },
    cdp: { enabled: true, timer: 60, holdtime: 180, version: "2" },
    lldp: { enabled: false, timer: 30, holdtime: 120, reinitDelay: 2 },
    dhcpSnooping: { enabled: false, vlans: [], verifyMacAddress: true },
    vtp: { mode: "server", domain: "", version: "2", pruning: false, revision: 0 },
    localUsers: [],
    services: { http: kind === "server", ftp: kind === "server", email: kind === "server", dhcp: false, dns: kind === "server", tftp: false, syslog: false },
    wireless: { ssid: kind === "wireless" ? "Lab-Wireless" : "", auth: "open", key: "", channel: 6, range: 180 }
  };
}

export function canPortUseCable(port: NetworkPort, cable: CableType): boolean {
  const ethernet: PortKind[] = ["ethernet", "fast-ethernet", "gigabit-ethernet"];
  if (cable === "auto") return true;
  if (cable === "console") return port.kind === "console";
  if (cable === "copper-straight" || cable === "copper-cross") return ethernet.includes(port.kind);
  if (cable === "serial-dce" || cable === "serial-dte") return port.kind === "serial";
  if (cable === "fiber") return port.kind === "fiber";
  if (cable === "wireless") return port.kind === "wireless";
  return false;
}

export function displayKind(kind: DeviceKind): string {
  return ({ router: "라우터", switch: "스위치", firewall: "방화벽", pc: "PC", server: "서버", wireless: "무선", hub: "허브" })[kind];
}

export function getDeviceModel(modelId: string): DeviceModel {
  const model = findDeviceModel(modelId);
  if (!model) throw new Error(`Unknown model ${modelId}`);
  return model;
}

export function getModuleSpec(moduleId: string): ModuleSpec | undefined {
  return moduleCatalog.find((module) => module.id === moduleId);
}

export function installedModuleForSlot(device: NetworkDevice, slotId: string): NetworkDevice["modules"][number] | undefined {
  return device.modules.find((module) => module.slotId === slotId || (module.occupiedSlotIds ?? []).includes(slotId));
}

export function installModule(device: NetworkDevice, slotId: string, moduleId: string): { ok: boolean; message: string; device: NetworkDevice } {
  if (device.powerOn) {
    return { ok: false, message: "모듈을 설치하기 전에 장비 전원을 끄세요.", device };
  }
  const model = getDeviceModel(device.modelId);
  const slot = model.modules.find((candidate) => candidate.id === slotId);
  if (!slot) {
    return { ok: false, message: "이 장비에는 해당 모듈 슬롯이 없습니다.", device };
  }
  if (installedModuleForSlot(device, slotId)) {
    return { ok: false, message: "다른 모듈을 추가하기 전에 설치된 모듈을 제거하세요.", device };
  }
  if (!slot.accepts.includes(moduleId)) {
    return { ok: false, message: "이 슬롯에서는 해당 모듈을 지원하지 않습니다.", device };
  }
  const spec = getModuleSpec(moduleId);
  if (!spec) {
    return { ok: false, message: "알 수 없는 모듈입니다.", device };
  }
  const occupiedSlotIds = occupiedSlotsForModule(model, slotId, spec);
  if (occupiedSlotIds.length < (spec.widthSlots ?? 1)) {
    return { ok: false, message: `${spec.label} 모듈은 연속된 빈 슬롯 ${spec.widthSlots ?? 1}개가 필요합니다.`, device };
  }
  const blockedSlotId = occupiedSlotIds.find((candidate) => installedModuleForSlot(device, candidate));
  if (blockedSlotId) {
    return { ok: false, message: `${spec.label} 모듈은 ${blockedSlotId} 슬롯도 사용해야 합니다. 해당 슬롯을 비우세요.`, device };
  }
  const incompatibleSlot = occupiedSlotIds
    .map((candidate) => model.modules.find((item) => item.id === candidate))
    .find((candidate) => !candidate?.accepts.includes(moduleId));
  if (incompatibleSlot) {
    return { ok: false, message: `${spec.label} 모듈은 ${incompatibleSlot.label} 슬롯과 호환되지 않습니다.`, device };
  }
  const existingNames = new Set(device.ports.map((port) => port.name));
  const nextPorts = spec.ports.map((port, index) => createPort(port, device.ports.length + index, { slotId, moduleId, existingNames }));
  return {
    ok: true,
    message: `${slot.label}에 ${spec.label} 모듈을 설치했습니다.${occupiedSlotIds.length > 1 ? ` 점유 슬롯: ${occupiedSlotIds.join(", ")}` : ""}`,
    device: {
      ...device,
      modules: [...device.modules, { slotId, moduleId, occupiedSlotIds }],
      ports: [...device.ports, ...nextPorts]
    }
  };
}

export function removeModule(device: NetworkDevice, slotId: string): { ok: boolean; message: string; device: NetworkDevice } {
  if (device.powerOn) {
    return { ok: false, message: "모듈을 제거하기 전에 장비 전원을 끄세요.", device };
  }
  const installed = installedModuleForSlot(device, slotId);
  if (!installed) {
    return { ok: false, message: "해당 슬롯에 설치된 모듈이 없습니다.", device };
  }
  const modulePorts = device.ports.filter((port) => port.moduleSlotId === installed.slotId);
  const connected = modulePorts.find((port) => port.linkId);
  if (connected) {
    return { ok: false, message: `모듈을 제거하기 전에 ${connected.name} 연결을 해제하세요.`, device };
  }
  const removedPortNames = new Set(modulePorts.map((port) => port.name));
  return {
    ok: true,
    message: `${installed.slotId}에서 ${installed.moduleId} 모듈을 제거했습니다.`,
    device: {
      ...device,
      modules: device.modules.filter((module) => module.slotId !== installed.slotId),
      ports: device.ports.filter((port) => port.moduleSlotId !== installed.slotId),
      runtime: {
        ...device.runtime,
        arpTable: device.runtime.arpTable.filter((entry) => !removedPortNames.has(entry.portName)),
        macTable: device.runtime.macTable.filter((entry) => !removedPortNames.has(entry.portName))
      }
    }
  };
}

function modulePortName(name: string, slotId: string): string {
  const slotIndex = Number(slotId.replace(/\D/g, "")) || 0;
  if (name.includes("{slot}")) {
    return name.replaceAll("{slot}", String(slotIndex));
  }
  if (/^Serial0\/0\//.test(name)) {
    return name.replace("Serial0/0/", `Serial0/${slotIndex}/`);
  }
  if (/^FastEthernet0\/0\//.test(name)) {
    return name.replace("FastEthernet0/0/", `FastEthernet0/${slotIndex}/`);
  }
  if (/^GigabitEthernet0\/0\//.test(name)) {
    return name.replace("GigabitEthernet0/0/", `GigabitEthernet0/${slotIndex}/`);
  }
  if (/^FastEthernet0\//.test(name) && slotIndex > 0) {
    return name.replace("FastEthernet0/", `FastEthernet${slotIndex}/`);
  }
  if (/^Wireless0$/.test(name) && slotIndex > 0) {
    return `Wireless${slotIndex}`;
  }
  return name;
}

function occupiedSlotsForModule(model: DeviceModel, slotId: string, spec: ModuleSpec): string[] {
  const width = spec.widthSlots ?? 1;
  const startIndex = model.modules.findIndex((slot) => slot.id === slotId);
  if (startIndex < 0) return [];
  return model.modules.slice(startIndex, startIndex + width).map((slot) => slot.id);
}

function uniquePortName(existing: Set<string>, baseName: string): string {
  if (!existing.has(baseName)) {
    return baseName;
  }
  let suffix = 1;
  while (existing.has(`${baseName}.${suffix}`)) {
    suffix += 1;
  }
  return `${baseName}.${suffix}`;
}

function createMac(seed: number): string {
  const value = Math.floor(Math.random() * 0xffffff);
  return `02:00:${((value >> 16) & 255).toString(16).padStart(2, "0")}:${((value >> 8) & 255).toString(16).padStart(2, "0")}:${(value & 255).toString(16).padStart(2, "0")}:${seed.toString(16).padStart(2, "0")}`;
}
