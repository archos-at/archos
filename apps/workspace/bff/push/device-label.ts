const MAX_LABEL = 120

function browserOf(ua: string): string | null {
  if (/\bEdg(e|A|iOS)?\//.test(ua)) return 'Edge'
  if (/\bOPR\/|\bOpera\b/.test(ua)) return 'Opera'
  if (/\bSamsungBrowser\//.test(ua)) return 'Samsung Internet'
  if (/\b(Firefox|FxiOS)\//.test(ua)) return 'Firefox'
  if (/\b(Chrome|CriOS)\//.test(ua)) return 'Chrome'
  if (/\bSafari\//.test(ua)) return 'Safari'
  return null
}

function deviceOf(ua: string): string | null {
  if (/\biPhone\b/.test(ua)) return 'iPhone'
  if (/\biPad\b/.test(ua)) return 'iPad'
  if (/\bAndroid\b/.test(ua)) return /\bMobile\b/.test(ua) ? 'Android-Smartphone' : 'Android-Tablet'
  if (/\bWindows\b/.test(ua)) return 'Windows'
  if (/\bMac OS X\b|\bMacintosh\b/.test(ua)) return 'Mac'
  if (/\bCrOS\b/.test(ua)) return 'Chromebook'
  if (/\bLinux\b|\bX11\b/.test(ua)) return 'Linux'
  return null
}

export function deviceLabelFromUserAgent(userAgent: string | null | undefined): string {
  const ua = (userAgent ?? '').slice(0, 512)
  const browser = browserOf(ua)
  const device = deviceOf(ua)
  const label = browser && device ? `${browser} auf ${device}` : (browser ?? device ?? 'Unbekanntes Gerät')
  return label.slice(0, MAX_LABEL)
}
