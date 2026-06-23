export function isIpv4(value: string): boolean {
  const parts = value.split(".");
  return parts.length === 4 && parts.every((part) => /^\d+$/.test(part) && Number(part) >= 0 && Number(part) <= 255);
}

export function ipToNumber(value: string): number {
  return value.split(".").reduce((acc, part) => (acc << 8) + Number(part), 0) >>> 0;
}

export function numberToIp(value: number): string {
  return [24, 16, 8, 0].map((shift) => String((value >>> shift) & 255)).join(".");
}

export function networkAddress(ip: string, mask: string): string {
  return numberToIp(ipToNumber(ip) & ipToNumber(mask));
}

export function ipInSubnet(ip: string, base: string, mask: string): boolean {
  return isIpv4(ip) && isIpv4(base) && isSubnetMask(mask) && networkAddress(ip, mask) === networkAddress(base, mask);
}

export function nextIp(ip: string, offset: number): string {
  return numberToIp((ipToNumber(ip) + offset) >>> 0);
}

export function maskToPrefix(mask: string): number {
  return ipToNumber(mask).toString(2).split("1").length - 1;
}

export function isSubnetMask(mask: string): boolean {
  if (!isIpv4(mask)) return false;
  const inverted = (~ipToNumber(mask)) >>> 0;
  return (inverted & (inverted + 1)) === 0;
}
