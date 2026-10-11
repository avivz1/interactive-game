// Capability checks shown on the TV so we can tell whether this TV browser can play.

export interface Check {
  label: string;
  ok: boolean;
  detail?: string;
}

export interface BrowserInfo {
  name: string;
  chromeMajor: number | null;
  ua: string;
}

export function browserInfo(): BrowserInfo {
  const ua = navigator.userAgent;
  const m = /Chrom(?:e|ium)\/(\d+)/.exec(ua);
  const chromeMajor = m ? Number(m[1]) : null;
  let name = 'Browser';
  if (/Tizen/i.test(ua)) name = 'Samsung TV (Tizen)';
  else if (/Web0S|webOS/i.test(ua)) name = 'LG TV (webOS)';
  else if (/AFT/.test(ua)) name = 'Fire TV';
  else if (/Android/i.test(ua) && /TV/i.test(ua)) name = 'Android TV';
  else if (/SamsungBrowser/i.test(ua)) name = 'Samsung Internet';
  else if (/Edg\//.test(ua)) name = 'Edge';
  else if (/Chrome\//.test(ua)) name = 'Chrome';
  else if (/Safari\//.test(ua)) name = 'Safari';
  else if (/Firefox\//.test(ua)) name = 'Firefox';
  return { name: chromeMajor ? name + ' · engine ' + chromeMajor : name, chromeMajor, ua };
}

function videoCodecs(): string[] {
  try {
    if (typeof RTCRtpReceiver === 'undefined' || !RTCRtpReceiver.getCapabilities) return [];
    const caps = RTCRtpReceiver.getCapabilities('video');
    const names: string[] = [];
    if (caps) {
      for (const c of caps.codecs) {
        const n = c.mimeType.replace('video/', '').toUpperCase();
        if (names.indexOf(n) < 0) names.push(n);
      }
    }
    return names;
  } catch (_e) {
    return [];
  }
}

export function hasWebRtc(): boolean {
  return typeof RTCPeerConnection === 'function';
}

export function runChecks(): Check[] {
  const rtc = hasWebRtc();
  const proto = rtc ? (RTCPeerConnection.prototype as unknown as Record<string, unknown>) : {};
  const codecs = videoCodecs();
  let webgl = false;
  try {
    const canvas = document.createElement('canvas');
    webgl = !!(canvas.getContext('webgl') || canvas.getContext('experimental-webgl'));
  } catch (_e) {
    webgl = false;
  }
  return [
    { label: 'WebRTC', ok: rtc },
    { label: 'Data channel', ok: rtc && 'createDataChannel' in proto },
    { label: 'Video receive', ok: rtc && 'addTransceiver' in proto },
    {
      label: 'Video codecs',
      ok: codecs.indexOf('H264') >= 0 || codecs.indexOf('VP8') >= 0,
      detail: codecs.filter((c) => c === 'H264' || c === 'VP8' || c === 'VP9' || c === 'AV1').join(' ') || 'unknown',
    },
    { label: 'WebGL', ok: webgl },
    { label: 'Frame timing', ok: 'requestVideoFrameCallback' in HTMLVideoElement.prototype },
  ];
}

export function offerLooksValid(sdp: string): boolean {
  return sdp.indexOf('m=video') >= 0 && sdp.indexOf('m=application') >= 0;
}
