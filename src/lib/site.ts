/**
 * Everything the site needs to know about where Tela lives, from the environment, so the same
 * build works on staging and production. See `.env.example`.
 */
export const site = {
  name: 'Tela',
  /** The public site, also the domain invite links (`/g/:code`) open the app from. */
  url: process.env.NEXT_PUBLIC_SITE_URL ?? 'https://tela.africa',
  appStoreUrl: process.env.NEXT_PUBLIC_APP_STORE_URL ?? '',
  playStoreUrl: process.env.NEXT_PUBLIC_PLAY_STORE_URL ?? '',
  /**
   * The Tela API, one address for the site's server and visitors' browsers alike. `NEXT_PUBLIC_`
   * so Next.js includes it in the browser's code (set at build time).
   */
  apiUrl: process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4110/api',
  /** The app's own link scheme: opens Tela directly when it's installed. */
  appScheme: 'tela',
};

/** Universal Links (iOS) and App Links (Android) need these to prove the app and site belong together. */
export const appLinks = {
  /** `TEAMID.bundle.id`, e.g. `ABCDE12345.africa.tela.app`. */
  iosAppId: process.env.IOS_APP_ID ?? '',
  androidPackage: process.env.ANDROID_PACKAGE ?? '',
  /** Comma-separated SHA-256 fingerprints of the Android signing certificates (Play App Signing + upload key). */
  androidFingerprints: (process.env.ANDROID_SHA256_FINGERPRINTS ?? '')
    .split(',')
    .map((f) => f.trim())
    .filter(Boolean),
  /** The paths the app handles; everything else stays on the website. */
  paths: ['/g/*'],
};

/** Placeholder photos from Pexels, to be swapped for Tela's own. Keep the aspect ratios when replacing. */
const pexels = (id: number, width = 1400) => `https://images.pexels.com/photos/${id}/pexels-photo-${id}.jpeg?auto=compress&cs=tinysrgb&w=${width}`;
export const photos = {
  hero: { src: pexels(6190671, 1200), alt: 'A smiling woman on a video call on her phone' },
  family: { src: pexels(12788382), alt: 'A family relaxing together in their living room' },
  friends: { src: pexels(5921967), alt: 'Two friends looking at a phone together over coffee' },
  students: { src: pexels(38451625), alt: 'Five students from the same class set, in matching uniforms and class-of-2025 sashes' },
  concert: { src: pexels(5193526), alt: 'A crowd at an outdoor concert at night' },
};
