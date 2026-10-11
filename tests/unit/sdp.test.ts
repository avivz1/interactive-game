import { describe, expect, it } from 'vitest';
import { checkRemoteSdp, parseCandidateLine, stripGlobalIPv6 } from '../../src/shared/sdp';

const cand = (addr: string, type = 'host') => `a=candidate:1 1 udp 2122260223 ${addr} 50000 typ ${type} generation 0`;
const sdp = (...lines: string[]) => ['v=0', 'o=- 1 2 IN IP4 127.0.0.1', 'm=video 9 UDP/TLS/RTP/SAVPF 96', ...lines, ''].join('\r\n');

describe('parseCandidateLine', () => {
  it('reads address and type', () => {
    expect(parseCandidateLine(cand('192.168.1.5'))).toEqual({ address: '192.168.1.5', type: 'host' });
    expect(parseCandidateLine('a=candidate:9 1 tcp 1518280447 abcd.local 9 typ host tcptype active')).toEqual({
      address: 'abcd.local',
      type: 'host',
    });
    expect(parseCandidateLine('a=mid:0')).toBeNull();
  });
});

describe('checkRemoteSdp', () => {
  it('keeps local-network host candidates', () => {
    const res = checkRemoteSdp(sdp(cand('192.168.1.5'), cand('x.local'), cand('fe80::1')));
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.sdp.match(/a=candidate/g)).toHaveLength(3);
  });

  it('drops public addresses but keeps the rest', () => {
    const res = checkRemoteSdp(sdp(cand('192.168.1.5'), cand('81.2.3.4'), cand('2a00:1:2:3::5')));
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.sdp).toContain('192.168.1.5');
      expect(res.sdp).not.toContain('81.2.3.4');
      expect(res.sdp).not.toContain('2a00:1:2:3::5');
    }
  });

  it('refuses reflexive or relay candidates (never sent by a genuine peer)', () => {
    expect(checkRemoteSdp(sdp(cand('192.168.1.5'), cand('81.2.3.4', 'prflx'))).ok).toBe(false);
    expect(checkRemoteSdp(sdp(cand('10.0.0.5', 'srflx'))).ok).toBe(false);
    expect(checkRemoteSdp(sdp(cand('10.0.0.5', 'relay'))).ok).toBe(false);
  });

  it('refuses SDPs without any local-network candidate', () => {
    expect(checkRemoteSdp(sdp(cand('81.2.3.4'))).ok).toBe(false);
    expect(checkRemoteSdp(sdp()).ok).toBe(false);
    expect(checkRemoteSdp(sdp('a=candidate:garbage')).ok).toBe(false);
  });
});

describe('stripGlobalIPv6', () => {
  it('removes only global IPv6 candidates', () => {
    const out = stripGlobalIPv6(sdp(cand('2a00:1:2:3::5'), cand('fd00::5'), cand('192.168.1.5'), cand('y.local')));
    expect(out).not.toContain('2a00:1:2:3::5');
    expect(out).toContain('fd00::5');
    expect(out).toContain('192.168.1.5');
    expect(out).toContain('y.local');
  });
});
