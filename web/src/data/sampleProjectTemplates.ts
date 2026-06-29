export type SampleProjectTemplateId = "routed-services" | "ospf-campus" | "dual-wan-pbr" | "firewall-dmz" | "wireless-campus";

export const sampleProjectTemplates: Array<{ id: SampleProjectTemplateId; name: string; detail: string }> = [
  { id: "routed-services", name: "라우팅 서비스", detail: "PC, 라우터, 서버 서비스 기본 검증" },
  { id: "ospf-campus", name: "OSPF 캠퍼스", detail: "L3 스위치 이중화와 OSPF 동적 라우팅" },
  { id: "dual-wan-pbr", name: "Dual-WAN PBR", detail: "Prefix-list, route-map, IP SLA, tracked static route" },
  { id: "firewall-dmz", name: "방화벽 DMZ", detail: "ASA/Firepower 스타일 inside/outside/dmz NAT와 ACL" },
  { id: "wireless-campus", name: "무선 캠퍼스", detail: "WLC, AP, 무선 클라이언트, 서비스 VLAN" }
];
