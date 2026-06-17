import { FormEvent, useEffect, useRef, useState } from "react";
import { CircleHelp, SendHorizontal, Terminal } from "lucide-react";
import type { NetworkDevice, NetworkProject } from "../types/network";
import { cliPrompt, runCliCommand } from "../engine/cli";

interface Props {
  project: NetworkProject;
  device: NetworkDevice;
  onDeviceChange: (device: NetworkDevice) => void;
  onProjectChange: (project: NetworkProject) => void;
}

const commandHints = [
  { template: "enable", insert: "enable", description: "privileged EXEC 모드로 전환" },
  { template: "configure terminal", insert: "configure terminal", description: "전역 설정 모드 진입" },
  { template: "hostname <name>", insert: "hostname ", description: "장비 이름 변경" },
  { template: "interface <name>", insert: "interface ", description: "포트 설정 모드 진입" },
  { template: "description <text>", insert: "description ", description: "인터페이스 설명 지정" },
  { template: "ip address <ip> <mask>", insert: "ip address ", description: "인터페이스 IP/마스크 설정" },
  { template: "no ip address", insert: "no ip address", description: "인터페이스 IP 제거" },
  { template: "ip helper-address <ip>", insert: "ip helper-address ", description: "DHCP relay helper 설정" },
  { template: "no ip helper-address", insert: "no ip helper-address", description: "DHCP relay helper 제거" },
  { template: "no shutdown", insert: "no shutdown", description: "선택 포트 활성화" },
  { template: "shutdown", insert: "shutdown", description: "선택 포트 비활성화" },
  { template: "duplex full", insert: "duplex full", description: "duplex 설정" },
  { template: "speed 100", insert: "speed 100", description: "포트 속도 설정" },
  { template: "clock rate <bps>", insert: "clock rate 64000", description: "Serial DCE clock rate 설정" },
  { template: "switchport mode access", insert: "switchport mode access", description: "스위치 포트를 access로 설정" },
  { template: "switchport mode trunk", insert: "switchport mode trunk", description: "스위치 포트를 trunk로 설정" },
  { template: "switchport trunk allowed vlan <list>", insert: "switchport trunk allowed vlan ", description: "trunk 허용 VLAN 목록 지정" },
  { template: "switchport access vlan <id>", insert: "switchport access vlan ", description: "access VLAN 지정" },
  { template: "ip route <network> <mask> <next-hop>", insert: "ip route ", description: "정적 라우트 추가" },
  { template: "no ip route <network> <mask> <next-hop>", insert: "no ip route ", description: "정적 라우트 제거" },
  { template: "ip host <name> <ip>", insert: "ip host ", description: "DNS host record 추가" },
  { template: "no ip host <name>", insert: "no ip host ", description: "DNS host record 제거" },
  { template: "access-list <id> deny icmp any any", insert: "access-list 101 deny icmp any any", description: "ACL 규칙 추가" },
  { template: "no access-list <id>", insert: "no access-list ", description: "ACL 번호 삭제" },
  { template: "ip dhcp pool <name>", insert: "ip dhcp pool ", description: "DHCP 풀 설정 모드 진입" },
  { template: "network <network> <mask>", insert: "network ", description: "DHCP/라우팅 네트워크 지정" },
  { template: "default-router <ip>", insert: "default-router ", description: "DHCP 기본 게이트웨이 지정" },
  { template: "dns-server <ip>", insert: "dns-server ", description: "DHCP DNS 서버 지정" },
  { template: "router rip", insert: "router rip", description: "RIP 라우팅 프로세스 진입" },
  { template: "router ospf", insert: "router ospf", description: "OSPF 라우팅 프로세스 진입" },
  { template: "router eigrp", insert: "router eigrp", description: "EIGRP 라우팅 프로세스 진입" },
  { template: "vlan <id>", insert: "vlan ", description: "VLAN 설정 모드 진입" },
  { template: "name <vlan-name>", insert: "name ", description: "VLAN 이름 지정" },
  { template: "show running-config", insert: "show running-config", description: "현재 설정 확인" },
  { template: "show startup-config", insert: "show startup-config", description: "저장 설정 확인" },
  { template: "show ip interface brief", insert: "show ip interface brief", description: "포트 IP와 상태 요약" },
  { template: "show interface <name>", insert: "show interface ", description: "인터페이스 상세 상태 확인" },
  { template: "show interfaces description", insert: "show interfaces description", description: "인터페이스 설명 요약" },
  { template: "show interfaces status", insert: "show interfaces status", description: "포트 연결 상태 요약" },
  { template: "show interfaces trunk", insert: "show interfaces trunk", description: "trunk 포트와 허용 VLAN 확인" },
  { template: "show inventory", insert: "show inventory", description: "장비와 모듈 inventory 확인" },
  { template: "show controllers serial <interface>", insert: "show controllers serial ", description: "Serial DCE/DTE와 clock 확인" },
  { template: "show cdp neighbors", insert: "show cdp neighbors", description: "직접 연결된 이웃 확인" },
  { template: "show ip route", insert: "show ip route", description: "라우팅 테이블 확인" },
  { template: "show ip protocols", insert: "show ip protocols", description: "라우팅 프로세스 요약" },
  { template: "show ip dhcp binding", insert: "show ip dhcp binding", description: "DHCP lease 확인" },
  { template: "show ip dhcp pool", insert: "show ip dhcp pool", description: "DHCP pool 요약" },
  { template: "show hosts", insert: "show hosts", description: "DNS host record 확인" },
  { template: "show arp", insert: "show arp", description: "ARP 테이블 확인" },
  { template: "show access-lists", insert: "show access-lists", description: "Firewall ACL 확인" },
  { template: "show vlan brief", insert: "show vlan brief", description: "VLAN 목록 확인" },
  { template: "show mac address-table", insert: "show mac address-table", description: "스위치 MAC 테이블 확인" },
  { template: "clear arp", insert: "clear arp", description: "ARP cache 초기화" },
  { template: "clear mac address-table dynamic", insert: "clear mac address-table dynamic", description: "동적 MAC 테이블 초기화" },
  { template: "ping <ip>", insert: "ping ", description: "IP 대상으로 ICMP 시뮬레이션 실행" },
  { template: "copy running-config startup-config", insert: "copy running-config startup-config", description: "현재 설정 저장" },
  { template: "write memory", insert: "write memory", description: "현재 설정 저장" },
  { template: "exit", insert: "exit", description: "한 단계 위 모드로 이동" },
  { template: "end", insert: "end", description: "privileged EXEC 모드로 이동" },
  { template: "help", insert: "help", description: "지원 명령 목록 출력" },
  { template: "?", insert: "?", description: "지원 명령 목록 출력" },
];

export default function CliTerminal({ project, device, onDeviceChange, onProjectChange }: Props) {
  const [command, setCommand] = useState("");
  const [history, setHistory] = useState<string[]>([cliPrompt(device)]);
  const [helpOpen, setHelpOpen] = useState(false);
  const [helpQuery, setHelpQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const outputRef = useRef<HTMLPreElement>(null);
  const normalizedQuery = helpQuery.trim().toLowerCase();
  const visibleCommands = commandHints.filter((entry) => `${entry.template} ${entry.description}`.toLowerCase().includes(normalizedQuery));

  useEffect(() => {
    setCommand("");
    setHistory([cliPrompt(device)]);
    inputRef.current?.focus();
  }, [device.id]);

  useEffect(() => {
    if (outputRef.current) outputRef.current.scrollTop = outputRef.current.scrollHeight;
  }, [history]);

  function submit(event: FormEvent) {
    event.preventDefault();
    const promptBefore = cliPrompt(device);
    const result = runCliCommand(device, command, project);
    setHistory((entries) => [...entries, command.trim() ? `${promptBefore} ${command.trim()}` : promptBefore, result.output]);
    setCommand("");
    if (result.project) {
      onProjectChange(result.project);
    } else {
      onDeviceChange(result.device);
    }
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  function fillCommand(value: string) {
    setCommand(value);
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  return (
    <div className="terminal-wrap">
      <div className="terminal-header">
        <Terminal size={16} />
        <span>{device.config.hostname}</span>
        <button type="button" className="terminal-help-button" onClick={() => setHelpOpen((value) => !value)} title="CLI 도움말">
          <CircleHelp size={15} />
        </button>
      </div>
      {helpOpen && (
        <div className="cli-help-panel">
          <input value={helpQuery} onChange={(event) => setHelpQuery(event.target.value)} placeholder="명령 검색" />
          <div className="cli-help-list">
            {visibleCommands.map((entry) => (
              <button key={entry.template} type="button" onClick={() => fillCommand(entry.insert)}>
                <strong>{entry.template}</strong>
                <span>{entry.description}</span>
              </button>
            ))}
          </div>
        </div>
      )}
      <pre ref={outputRef} className="terminal-output" onClick={() => inputRef.current?.focus()}>{history.join("\n")}</pre>
      <form onSubmit={submit} className="terminal-input">
        <span className="terminal-prompt">{cliPrompt(device)}</span>
        <input ref={inputRef} value={command} onChange={(event) => setCommand(event.target.value)} spellCheck={false} autoComplete="off" autoFocus />
        <button type="submit" title="명령 실행">
          <SendHorizontal size={16} />
        </button>
      </form>
    </div>
  );
}
