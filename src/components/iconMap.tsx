import { CircleDot, Monitor, Network, Router, Server, Shield, Wifi } from "lucide-react";

export function DeviceIcon({ icon, size = 18 }: { icon: string; size?: number }) {
  if (icon === "route") return <Router size={size} />;
  if (icon === "network") return <Network size={size} />;
  if (icon === "shield") return <Shield size={size} />;
  if (icon === "monitor") return <Monitor size={size} />;
  if (icon === "server") return <Server size={size} />;
  if (icon === "wifi") return <Wifi size={size} />;
  return <CircleDot size={size} />;
}
