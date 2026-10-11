// Decides whether a WebRTC peer address is on the local network. The phone only
// sends camera frames to a TV on the same network, so a stranger who obtains a
// pairing code over the internet cannot receive the video.

function parseIPv4(addr: string): number[] | null {
  const parts = addr.split('.');
  if (parts.length !== 4) return null;
  const out: number[] = [];
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null;
    const n = Number(p);
    if (n > 255) return null;
    out.push(n);
  }
  return out;
}

/** Expands an IPv6 address to 8 hextets; returns null when invalid. */
export function parseIPv6(input: string): number[] | null {
  let addr = input.trim();
  if (addr.charAt(0) === '[' && addr.charAt(addr.length - 1) === ']') addr = addr.slice(1, -1);
  const zone = addr.indexOf('%');
  if (zone >= 0) addr = addr.slice(0, zone);
  if (addr.indexOf(':') < 0) return null;

  let tail: number[] = [];
  const lastColon = addr.lastIndexOf(':');
  const maybeV4 = addr.slice(lastColon + 1);
  if (maybeV4.indexOf('.') >= 0) {
    const v4 = parseIPv4(maybeV4);
    if (!v4) return null;
    tail = [(v4[0] << 8) | v4[1], (v4[2] << 8) | v4[3]];
    // Keep a trailing '::' (e.g. '::1.2.3.4'), otherwise drop the separator colon.
    addr = addr.charAt(lastColon - 1) === ':' ? addr.slice(0, lastColon + 1) : addr.slice(0, lastColon);
  }

  const halves = addr.split('::');
  if (halves.length > 2) return null;
  const toHextets = (s: string): number[] | null => {
    if (s === '') return [];
    const out: number[] = [];
    for (const h of s.split(':')) {
      if (!/^[0-9a-fA-F]{1,4}$/.test(h)) return null;
      out.push(parseInt(h, 16));
    }
    return out;
  };
  const head = toHextets(halves[0]);
  if (!head) return null;
  let words: number[];
  if (halves.length === 2) {
    const rest = toHextets(halves[1]);
    if (!rest) return null;
    const missing = 8 - tail.length - head.length - rest.length;
    if (missing < 1) return null;
    words = head.concat(new Array(missing).fill(0), rest, tail);
  } else {
    words = head.concat(tail);
  }
  return words.length === 8 ? words : null;
}

export function isPrivateAddress(addr: string): boolean {
  const a = addr.trim().toLowerCase();
  if (!a) return false;
  if (a.slice(-6) === '.local') return true; // mDNS names only resolve on the local link
  const v4 = parseIPv4(a);
  if (v4) {
    const [x, y] = v4;
    return (
      x === 10 ||
      x === 127 ||
      (x === 172 && y >= 16 && y <= 31) ||
      (x === 192 && y === 168) ||
      (x === 169 && y === 254)
    );
  }
  const v6 = parseIPv6(a);
  if (!v6) return false;
  const loopback = v6.slice(0, 7).every((w) => w === 0) && v6[7] === 1;
  const uniqueLocal = (v6[0] & 0xfe00) === 0xfc00;
  const linkLocal = (v6[0] & 0xffc0) === 0xfe80;
  const mappedV4 = v6.slice(0, 5).every((w) => w === 0) && v6[5] === 0xffff;
  if (mappedV4) {
    return isPrivateAddress([v6[6] >> 8, v6[6] & 255, v6[7] >> 8, v6[7] & 255].join('.'));
  }
  return loopback || uniqueLocal || linkLocal;
}

function sameIPv6Subnet64(a: string, b: string): boolean {
  const x = parseIPv6(a);
  const y = parseIPv6(b);
  if (!x || !y) return false;
  for (let i = 0; i < 4; i++) if (x[i] !== y[i]) return false;
  return true;
}

export interface CandidateInfo {
  address: string;
  candidateType: string;
}

/**
 * True when the selected ICE pair stays inside the home network.
 * Only host/peer-reflexive candidates exist because no STUN/TURN servers are configured;
 * the remaining risk is a public address (e.g. global IPv6), which is rejected unless
 * both ends share the same /64 prefix.
 */
export function isLanPair(local: CandidateInfo, remote: CandidateInfo): boolean {
  if (remote.candidateType === 'relay' || remote.candidateType === 'srflx') return false;
  if (local.candidateType === 'relay' || local.candidateType === 'srflx') return false;
  const r = remote.address;
  if (r) {
    if (isPrivateAddress(r)) return true;
    if (r.toLowerCase() === local.address.toLowerCase()) return true; // both ends on this device
    return local.address !== '' && sameIPv6Subnet64(r, local.address);
  }
  // Hidden host address = an mDNS name, which only resolves on the local link.
  if (remote.candidateType === 'host') return true;
  // Otherwise decide from our own side: traffic reaching a private local address
  // can only come from the local network.
  return local.address !== '' && isPrivateAddress(local.address);
}
