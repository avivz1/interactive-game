import { describe, expect, it } from 'vitest';
import { isLanPair, isPrivateAddress, parseIPv6 } from '../../src/shared/lan';

describe('parseIPv6', () => {
  it('expands compressed and embedded-IPv4 forms', () => {
    expect(parseIPv6('::1')).toEqual([0, 0, 0, 0, 0, 0, 0, 1]);
    expect(parseIPv6('fe80::1%wlan0')).toEqual([0xfe80, 0, 0, 0, 0, 0, 0, 1]);
    expect(parseIPv6('[2001:db8::8:800:200c:417a]')).toEqual([0x2001, 0xdb8, 0, 0, 8, 0x800, 0x200c, 0x417a]);
    expect(parseIPv6('::ffff:192.168.1.5')).toEqual([0, 0, 0, 0, 0, 0xffff, 0xc0a8, 0x0105]);
    expect(parseIPv6('::192.168.1.5')).toEqual([0, 0, 0, 0, 0, 0, 0xc0a8, 0x0105]);
    expect(parseIPv6('64:ff9b::10.0.0.1')).toEqual([0x64, 0xff9b, 0, 0, 0, 0, 0x0a00, 0x0001]);
  });

  it('rejects invalid input', () => {
    expect(parseIPv6('1::2::3')).toBeNull();
    expect(parseIPv6('12345::')).toBeNull();
    expect(parseIPv6('1:2:3:4:5:6:7:8:9')).toBeNull();
    expect(parseIPv6('10.0.0.1')).toBeNull();
  });
});

describe('isPrivateAddress', () => {
  it.each([
    ['10.1.2.3', true],
    ['172.16.0.1', true],
    ['172.31.255.255', true],
    ['172.32.0.1', false],
    ['192.168.0.10', true],
    ['169.254.1.1', true],
    ['127.0.0.1', true],
    ['8.8.8.8', false],
    ['100.64.0.1', false],
    ['fd12:3456::1', true],
    ['fe80::abcd', true],
    ['::1', true],
    ['::ffff:192.168.1.1', true],
    ['::ffff:8.8.8.8', false],
    ['2001:4860:4860::8888', false],
    ['3f2a1b2c-1111-2222-3333-444455556666.local', true],
    ['', false],
    ['999.1.1.1', false],
  ])('%s -> %s', (addr, expected) => {
    expect(isPrivateAddress(addr)).toBe(expected);
  });
});

describe('isLanPair', () => {
  const host = (address: string) => ({ address, candidateType: 'host' });

  it('accepts private remote addresses', () => {
    expect(isLanPair(host('192.168.1.20'), host('192.168.1.30'))).toBe(true);
  });

  it('accepts global IPv6 only within the same /64', () => {
    expect(isLanPair(host('2a00:1:2:3::10'), host('2a00:1:2:3::20'))).toBe(true);
    expect(isLanPair(host('2a00:1:2:3::10'), { address: '2a00:9:9:9::20', candidateType: 'prflx' })).toBe(false);
  });

  it('accepts both ends on the same device', () => {
    expect(isLanPair(host('192.0.2.2'), { address: '192.0.2.2', candidateType: 'prflx' })).toBe(true);
  });

  it('rejects public IPv4 and relayed candidates', () => {
    expect(isLanPair(host('192.168.1.2'), host('81.2.3.4'))).toBe(false);
    expect(isLanPair(host('192.168.1.2'), { address: '10.0.0.1', candidateType: 'relay' })).toBe(false);
    expect(isLanPair({ address: '10.0.0.2', candidateType: 'srflx' }, host('10.0.0.1'))).toBe(false);
  });

  it('treats a hidden remote host address (mDNS name) as local', () => {
    expect(isLanPair(host('81.2.3.4'), host(''))).toBe(true);
  });

  it('falls back to the local address when a peer-reflexive address is hidden', () => {
    const prflx = { address: '', candidateType: 'prflx' };
    expect(isLanPair(host('10.0.0.2'), prflx)).toBe(true);
    expect(isLanPair(host('81.2.3.4'), prflx)).toBe(false);
    expect(isLanPair(host(''), prflx)).toBe(false);
  });
});
