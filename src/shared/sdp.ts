// ICE candidate filtering for the LAN-only design.
//
// Neither side uses STUN/TURN, so a genuine peer only ever signals `typ host`
// candidates with private IPv4, local IPv6 or mDNS (.local) addresses. Accepting
// only those means our ICE agent never sends packets to the internet, so only
// devices on the local network can connect. Global IPv6 host candidates are
// dropped on both sides: they are routable from the internet and Chrome hides
// them in stats, which would make the LAN check unreliable.

import { isPrivateAddress, parseIPv6 } from './lan';

interface Candidate {
  address: string;
  type: string;
}

/** Parses `a=candidate:<foundation> <component> <transport> <priority> <address> <port> typ <type> ...`. */
export function parseCandidateLine(line: string): Candidate | null {
  const m = /^a=candidate:\S+ \d+ \S+ \d+ (\S+) \d+ typ (\S+)/.exec(line.trim());
  return m ? { address: m[1], type: m[2] } : null;
}

const isGlobalIPv6 = (addr: string): boolean => parseIPv6(addr) !== null && !isPrivateAddress(addr);

function splitLines(sdp: string): string[] {
  return sdp.split(/\r?\n/);
}

function joinLines(lines: string[]): string {
  return lines.join('\r\n');
}

/** Removes our own global IPv6 candidates before sending the SDP. */
export function stripGlobalIPv6(sdp: string): string {
  return joinLines(
    splitLines(sdp).filter((line) => {
      const c = parseCandidateLine(line);
      return !(c && isGlobalIPv6(c.address));
    }),
  );
}

export type RemoteSdpCheck = { ok: true; sdp: string } | { ok: false; reason: string };

/**
 * Validates the other device's SDP before it is applied: rejects any non-host
 * candidate (a genuine peer never has one) and drops candidates with public
 * addresses, so our ICE agent only ever contacts local-network addresses.
 */
export function checkRemoteSdp(sdp: string): RemoteSdpCheck {
  const kept: string[] = [];
  let candidates = 0;
  for (const line of splitLines(sdp)) {
    if (line.indexOf('a=candidate:') !== 0) {
      kept.push(line);
      continue;
    }
    const c = parseCandidateLine(line);
    if (!c) return { ok: false, reason: 'unreadable network address' };
    if (c.type !== 'host') return { ok: false, reason: 'not a local-network device' };
    if (!isPrivateAddress(c.address)) continue;
    candidates++;
    kept.push(line);
  }
  if (candidates === 0) return { ok: false, reason: 'no local-network address' };
  return { ok: true, sdp: joinLines(kept) };
}
