export interface ClientInfo {
  device: 'mobile' | 'tablet' | 'desktop';
  browser: string;
  os: string;
}

const BOT = /bot|crawler|spider|crawling|preview|facebookexternalhit|whatsapp|slurp|headless|lighthouse/i;

const BROWSERS: Array<[RegExp, string]> = [
  [/edg\//i, 'Edge'],
  [/opr\/|opera/i, 'Opera'],
  [/samsungbrowser/i, 'Samsung Internet'],
  [/firefox|fxios/i, 'Firefox'],
  [/chrome|crios/i, 'Chrome'],
  [/safari/i, 'Safari'],
];

const SYSTEMS: Array<[RegExp, string]> = [
  [/iphone|ipad|ipod/i, 'iOS'],
  [/android/i, 'Android'],
  [/windows/i, 'Windows'],
  [/mac os x|macintosh/i, 'macOS'],
  [/cros/i, 'ChromeOS'],
  [/linux/i, 'Linux'],
];

const match = (ua: string, table: Array<[RegExp, string]>) =>
  table.find(([re]) => re.test(ua))?.[1] ?? 'Outro';

export const isBot = (ua: string | undefined) => !ua || BOT.test(ua);

export function parseUserAgent(ua: string): ClientInfo {
  const tablet = /ipad|tablet|(android(?!.*mobile))/i.test(ua);
  const mobile = !tablet && /mobi|iphone|ipod|android/i.test(ua);
  return {
    device: tablet ? 'tablet' : mobile ? 'mobile' : 'desktop',
    browser: match(ua, BROWSERS),
    os: match(ua, SYSTEMS),
  };
}
