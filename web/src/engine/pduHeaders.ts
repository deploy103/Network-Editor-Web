import type { SimulationEvent } from "../types/network";

export type PduHeaderRows = NonNullable<SimulationEvent["headers"]>;

export interface PduTransportDescriptor {
  protocol: string;
  ports?: string;
  sourcePort?: string;
  destinationPort?: string;
  operation?: string;
  icmpType?: string;
  icmpCode?: string;
}

export function buildPduHeaders(protocolName: string, disposition: string, sourceValue: string, targetValue: string): PduHeaderRows {
  const protocol = protocolName.toUpperCase();
  const source = sourceValue || "unknown";
  const target = targetValue || "unknown";
  if (protocol === "ARP" || protocol === "SWITCH" || protocol === "HUB") {
    return [
      { layer: "Layer 2", field: "Frame type", value: protocol },
      { layer: "Layer 2", field: "Source", value: source },
      { layer: "Layer 2", field: "Destination", value: target },
      { layer: "Layer 2", field: "Action", value: disposition }
    ];
  }

  const transport = pduTransportForProtocol(protocol);
  const headers: PduHeaderRows = [
    { layer: "Layer 2", field: "EtherType", value: protocol === "DHCP" ? "IPv4 / broadcast-capable" : "IPv4" },
    { layer: "Layer 3", field: "Source", value: source },
    { layer: "Layer 3", field: "Destination", value: target },
    { layer: "Layer 3", field: "Protocol", value: transport.protocol === "ICMP" ? "ICMP" : "IP" },
    { layer: "Layer 4", field: "Protocol", value: transport.protocol }
  ];

  if (transport.icmpType) headers.push({ layer: "Layer 4", field: "Type", value: transport.icmpType });
  if (transport.icmpCode) headers.push({ layer: "Layer 4", field: "Code", value: transport.icmpCode });
  if (transport.sourcePort) headers.push({ layer: "Layer 4", field: "Source port", value: transport.sourcePort });
  if (transport.destinationPort) headers.push({ layer: "Layer 4", field: "Destination port", value: transport.destinationPort });
  if (transport.ports) headers.push({ layer: "Layer 4", field: "Ports", value: transport.ports });
  headers.push({ layer: "Layer 7", field: "Application", value: protocol });
  if (transport.operation) headers.push({ layer: "Layer 7", field: "Operation", value: transport.operation });
  headers.push({ layer: "Packet", field: "Disposition", value: disposition });
  return headers;
}

export function pduTransportForProtocol(protocol: string): PduTransportDescriptor {
  if (protocol === "ICMP") return { protocol: "ICMP", icmpType: "Echo", icmpCode: "0", operation: "Echo request" };
  if (protocol === "DHCP") return { protocol: "UDP", ports: "67/68", sourcePort: "68", destinationPort: "67", operation: "Discover/Request" };
  if (protocol === "DNS") return { protocol: "UDP", ports: "53", sourcePort: "49152", destinationPort: "53", operation: "Query" };
  if (protocol === "HTTP") return { protocol: "TCP", ports: "80", sourcePort: "49152", destinationPort: "80", operation: "GET" };
  if (protocol === "FTP") return { protocol: "TCP", ports: "21", sourcePort: "49152", destinationPort: "21", operation: "Control" };
  if (protocol === "EMAIL") return { protocol: "TCP", ports: "25", sourcePort: "49152", destinationPort: "25", operation: "SMTP" };
  if (protocol === "TFTP") return { protocol: "UDP", ports: "69", sourcePort: "49152", destinationPort: "69", operation: "Read request" };
  if (protocol === "SYSLOG") return { protocol: "UDP", ports: "514", sourcePort: "49152", destinationPort: "514", operation: "Message" };
  if (protocol === "SSH") return { protocol: "TCP", ports: "22", sourcePort: "49152", destinationPort: "22", operation: "Session open" };
  if (protocol === "TELNET") return { protocol: "TCP", ports: "23", sourcePort: "49152", destinationPort: "23", operation: "Session open" };
  return { protocol: "IP" };
}
