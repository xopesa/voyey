import { isIP } from "node:net";

// Explicit peers only. Never trust every caller or a hop count.
export function trustedProxyPeers(value?: string): false | string[] {
  if (!value?.trim()) return false;
  const peers = value.split(",").map((peer) => peer.trim());
  for (const peer of peers) {
    const [ip, mask, extra] = peer.split("/");
    const family = isIP(ip ?? "");
    if (
      !family ||
      extra !== undefined ||
      (mask !== undefined &&
        (!/^\d+$/.test(mask) ||
          Number(mask) < 1 ||
          Number(mask) > (family === 4 ? 32 : 128)))
    )
      throw new Error(
        "TRUST_PROXY must contain explicit IP addresses or non-zero CIDR ranges",
      );
  }
  return peers;
}
