use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet, VecDeque};
use wasm_bindgen::prelude::*;

#[derive(Debug, Clone, Deserialize)]
pub struct EngineProject {
    pub devices: Vec<EngineDevice>,
    pub links: Vec<EngineLink>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct EngineDevice {
    pub id: String,
    pub label: String,
    pub kind: String,
    pub power_on: bool,
    pub ports: Vec<EnginePort>,
    #[serde(default)]
    pub static_routes: Vec<StaticRoute>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct EnginePort {
    pub id: String,
    pub name: String,
    pub mac: String,
    pub admin_up: bool,
    pub mode: String,
    pub vlan: u16,
    #[serde(default)]
    pub allowed_vlans: Vec<u16>,
    #[serde(default)]
    pub ip: String,
    #[serde(default)]
    pub mask: String,
    #[serde(default)]
    pub gateway: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct StaticRoute {
    pub network: String,
    pub mask: String,
    pub next_hop: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct EngineLink {
    pub id: String,
    pub a_device: String,
    pub a_port: String,
    pub b_device: String,
    pub b_port: String,
    pub status: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct EngineResult {
    pub success: bool,
    pub message: String,
    pub events: Vec<EngineEvent>,
}

#[derive(Debug, Clone, Serialize)]
pub struct EngineEvent {
    #[serde(rename = "lastDeviceId")]
    pub last_device_id: String,
    #[serde(rename = "atDeviceId")]
    pub at_device_id: String,
    #[serde(rename = "type")]
    pub event_type: String,
    pub info: String,
    pub status: String,
    #[serde(rename = "osiLayers")]
    pub osi_layers: Vec<String>,
}

#[wasm_bindgen]
pub fn simulate_ping(project_json: &str, source_id: &str, target_id: &str) -> String {
    let project: EngineProject = match serde_json::from_str(project_json) {
        Ok(project) => project,
        Err(error) => {
            return serialize_result(EngineResult {
                success: false,
                message: format!("Invalid engine project: {error}"),
                events: vec![],
            });
        }
    };

    serialize_result(simulate_ping_inner(&project, source_id, target_id))
}

#[wasm_bindgen]
pub fn engine_version() -> String {
    "network-engine-rust-wasm/0.2.0".to_string()
}

fn simulate_ping_inner(project: &EngineProject, source_id: &str, target_id: &str) -> EngineResult {
    let source = match project.devices.iter().find(|device| device.id == source_id && device.power_on) {
        Some(device) => device,
        None => return fail(source_id, source_id, "ICMP", "Source device is missing or powered off."),
    };
    let target = match project.devices.iter().find(|device| device.id == target_id && device.power_on) {
        Some(device) => device,
        None => return fail(source_id, target_id, "ICMP", "Target device is missing or powered off."),
    };
    let source_port = match first_ip_port(source) {
        Some(port) => port,
        None => return fail(&source.id, &source.id, "ICMP", "Source has no active IPv4 interface."),
    };
    let target_port = match first_ip_port(target) {
        Some(port) => port,
        None => return fail(&source.id, &target.id, "ICMP", "Target has no active IPv4 interface."),
    };

    let path = if same_subnet(&source_port.ip, &target_port.ip, &source_port.mask) {
        find_l2_path(project, &source.id, &target.id, source_port.vlan)
    } else if source_port.gateway.is_empty() {
        vec![]
    } else {
        route_path(project, &source.id, source_port.vlan, &source_port.gateway, &target_port.ip, target_id)
    };

    if path.is_empty() {
        return fail(&source.id, &target.id, "ICMP", "No active L2/L3 path to target.");
    }

    let mut events = Vec::new();
    events.push(EngineEvent {
        last_device_id: source.id.clone(),
        at_device_id: source.id.clone(),
        event_type: "ARP".to_string(),
        info: format!("Resolve {} before ICMP echo.", target_port.ip),
        status: "forwarded".to_string(),
        osi_layers: vec!["Layer 2".to_string(), "Layer 3".to_string()],
    });
    for window in path.windows(2) {
        let at_id = window[1].as_str();
        let at_device = project.devices.iter().find(|device| device.id == at_id);
        let (event_type, info, osi_layers) = if at_id != target.id.as_str() {
            match at_device.map(|device| device.kind.as_str()) {
                Some("hub") => (
                    "HUB".to_string(),
                    "Hub flooded the frame out active ports.".to_string(),
                    vec!["Layer 1".to_string(), "Layer 2".to_string()],
                ),
                Some("switch") | Some("wireless") => (
                    "SWITCH".to_string(),
                    "Frame forwarded using VLAN/MAC state.".to_string(),
                    vec!["Layer 2".to_string()],
                ),
                _ => (
                    "ICMP".to_string(),
                    "Echo request forwarded.".to_string(),
                    vec!["Layer 2".to_string(), "Layer 3".to_string()],
                ),
            }
        } else {
            (
                "ICMP".to_string(),
                "Echo request arrived at destination.".to_string(),
                vec!["Layer 2".to_string(), "Layer 3".to_string()],
            )
        };
        events.push(EngineEvent {
            last_device_id: window[0].clone(),
            at_device_id: window[1].clone(),
            event_type,
            info,
            status: "forwarded".to_string(),
            osi_layers,
        });
    }
    events.push(EngineEvent {
        last_device_id: target.id.clone(),
        at_device_id: source.id.clone(),
        event_type: "ICMP".to_string(),
        info: "Echo reply delivered.".to_string(),
        status: "delivered".to_string(),
        osi_layers: vec!["Layer 3".to_string()],
    });

    EngineResult {
        success: true,
        message: format!("Reply from {}: bytes=32 time<1ms TTL=128", target_port.ip),
        events,
    }
}

fn first_ip_port(device: &EngineDevice) -> Option<&EnginePort> {
    device
        .ports
        .iter()
        .find(|port| port.admin_up && !port.ip.is_empty() && !port.mask.is_empty())
}

fn find_l2_path(project: &EngineProject, source_id: &str, target_id: &str, vlan: u16) -> Vec<String> {
    let adjacency = adjacency(project, vlan);
    bfs(project, source_id, target_id, &adjacency)
}

fn route_path(project: &EngineProject, source_id: &str, source_vlan: u16, gateway_ip: &str, target_ip: &str, target_id: &str) -> Vec<String> {
    let gateway = project
        .devices
        .iter()
        .find(|device| device.ports.iter().any(|port| port.ip == gateway_ip));
    let Some(gateway) = gateway else {
        return vec![];
    };
    let Some(gateway_port) = gateway.ports.iter().find(|port| port.ip == gateway_ip) else {
        return vec![];
    };

    let first_leg = find_l2_path(project, source_id, &gateway.id, source_vlan);
    if first_leg.is_empty() {
        return vec![];
    }

    let target_device = project.devices.iter().find(|device| device.id == target_id);
    let Some(target_device) = target_device else {
        return vec![];
    };
    let Some(target_port) = first_ip_port(target_device) else {
        return vec![];
    };

    if let Some(exit_port) = gateway
        .ports
        .iter()
        .find(|port| !port.ip.is_empty() && same_subnet(&port.ip, target_ip, &port.mask))
    {
        let final_leg = find_l2_path(project, &gateway.id, target_id, exit_port.vlan);
        return merge_paths(first_leg, final_leg);
    }

    let route = gateway
        .static_routes
        .iter()
        .find(|route| ip_in_subnet(target_ip, &route.network, &route.mask));
    let Some(route) = route else {
        return vec![];
    };
    let next_hop_device = project
        .devices
        .iter()
        .find(|device| device.ports.iter().any(|port| port.ip == route.next_hop));
    let Some(next_hop_device) = next_hop_device else {
        return vec![];
    };
    let exit_port = gateway
        .ports
        .iter()
        .find(|port| !port.ip.is_empty() && same_subnet(&route.next_hop, &port.ip, &port.mask));
    let Some(exit_port) = exit_port else {
        return vec![];
    };
    let next_leg = find_l2_path(project, &gateway.id, &next_hop_device.id, exit_port.vlan);
    let last_leg = find_l2_path(project, &next_hop_device.id, target_id, target_port.vlan);
    merge_paths(merge_paths(first_leg, next_leg), last_leg)
}

fn adjacency(project: &EngineProject, vlan: u16) -> HashMap<String, Vec<String>> {
    let mut map: HashMap<String, Vec<String>> = HashMap::new();
    for link in project.links.iter().filter(|link| link.status == "up") {
        let a = endpoint_port(project, &link.a_device, &link.a_port);
        let b = endpoint_port(project, &link.b_device, &link.b_port);
        let (Some(a), Some(b)) = (a, b) else {
            continue;
        };
        if port_carries_vlan(a, vlan) && port_carries_vlan(b, vlan) {
            map.entry(link.a_device.clone()).or_default().push(link.b_device.clone());
            map.entry(link.b_device.clone()).or_default().push(link.a_device.clone());
        }
    }
    map
}

fn endpoint_port<'a>(project: &'a EngineProject, device_id: &str, port_id: &str) -> Option<&'a EnginePort> {
    project
        .devices
        .iter()
        .find(|device| device.id == device_id && device.power_on)
        .and_then(|device| device.ports.iter().find(|port| port.id == port_id && port.admin_up))
}

fn port_carries_vlan(port: &EnginePort, vlan: u16) -> bool {
    match port.mode.as_str() {
        "trunk" => port.allowed_vlans.contains(&vlan),
        _ => port.vlan == vlan,
    }
}

fn bfs(project: &EngineProject, start: &str, target: &str, adjacency: &HashMap<String, Vec<String>>) -> Vec<String> {
    let mut queue = VecDeque::from([start.to_string()]);
    let mut parent: HashMap<String, String> = HashMap::new();
    let mut seen = HashSet::from([start.to_string()]);

    while let Some(node) = queue.pop_front() {
        if node == target {
            let mut path = vec![node.clone()];
            let mut current = node;
            while let Some(previous) = parent.get(&current) {
                path.push(previous.clone());
                current = previous.clone();
            }
            path.reverse();
            return path;
        }
        if node != start && node != target && !can_forward_l2(project, &node) {
            continue;
        }
        for next in adjacency.get(&node).into_iter().flatten() {
            if seen.insert(next.clone()) {
                parent.insert(next.clone(), node.clone());
                queue.push_back(next.clone());
            }
        }
    }
    vec![]
}

fn can_forward_l2(project: &EngineProject, device_id: &str) -> bool {
    project
        .devices
        .iter()
        .find(|device| device.id == device_id && device.power_on)
        .map(|device| matches!(device.kind.as_str(), "switch" | "hub" | "wireless"))
        .unwrap_or(false)
}

fn merge_paths(mut left: Vec<String>, right: Vec<String>) -> Vec<String> {
    if left.is_empty() {
        return right;
    }
    if right.is_empty() {
        return left;
    }
    left.extend(right.into_iter().skip(1));
    left
}

fn same_subnet(a: &str, b: &str, mask: &str) -> bool {
    ip_in_subnet(a, b, mask)
}

fn ip_in_subnet(ip: &str, network_or_ip: &str, mask: &str) -> bool {
    let Some(ip) = ipv4_to_u32(ip) else {
        return false;
    };
    let Some(base) = ipv4_to_u32(network_or_ip) else {
        return false;
    };
    let Some(mask) = ipv4_to_u32(mask) else {
        return false;
    };
    (ip & mask) == (base & mask)
}

fn ipv4_to_u32(value: &str) -> Option<u32> {
    let parts: Vec<u8> = value
        .split('.')
        .map(str::parse)
        .collect::<Result<Vec<_>, _>>()
        .ok()?;
    if parts.len() != 4 {
        return None;
    }
    Some(((parts[0] as u32) << 24) | ((parts[1] as u32) << 16) | ((parts[2] as u32) << 8) | parts[3] as u32)
}

fn fail(last: &str, at: &str, event_type: &str, message: &str) -> EngineResult {
    EngineResult {
        success: false,
        message: message.to_string(),
        events: vec![EngineEvent {
            last_device_id: last.to_string(),
            at_device_id: at.to_string(),
            event_type: event_type.to_string(),
            info: message.to_string(),
            status: "dropped".to_string(),
            osi_layers: vec!["Layer 3".to_string()],
        }],
    }
}

fn serialize_result(result: EngineResult) -> String {
    serde_json::to_string(&result).unwrap_or_else(|_| "{\"success\":false,\"message\":\"serialization failed\",\"events\":[]}".to_string())
}
