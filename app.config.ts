import type { ConfigContext, ExpoConfig } from 'expo/config';
import { withEntitlementsPlist } from 'expo/config-plugins';

/**
 * `app.json` plus what depends on the environment: the website's domain, whose invite links
 * (`https://<domain>/g/CODE`) open Tasa directly. The site serves the matching
 * apple-app-site-association and assetlinks.json files (see tela-web).
 */
const site = new URL(process.env.EXPO_PUBLIC_SITE_URL ?? 'https://tasa.ng');

/**
 * A free Apple ID (Xcode "Personal Team") can't sign Associated Domains or Push Notifications.
 * Set IOS_FREE_SIGNING=1 in `.env.local` to leave both out of local iOS builds; store builds,
 * which don't set it, keep them.
 */
const freeSigning = process.env.IOS_FREE_SIGNING === '1';

export default ({ config }: ConfigContext): ExpoConfig => {
  const result: ExpoConfig = {
    ...config,
    name: config.name ?? 'Tasa',
    slug: config.slug ?? 'tasa',
    ios: {
      ...config.ios,
      // Universal Links: iOS opens these in Tasa once it verifies the site's file.
      associatedDomains: freeSigning ? [] : [`applinks:${site.host}`],
    },
    android: {
      ...config.android,
      // App Links: autoVerify checks the site's assetlinks.json, so there's no "open with…" prompt.
      intentFilters: [
        {
          action: 'VIEW',
          autoVerify: true,
          data: [{ scheme: 'https', host: site.host, pathPrefix: '/g/' }],
          category: ['BROWSABLE', 'DEFAULT'],
        },
      ],
    },
  };
  if (!freeSigning) return result;
  // expo-notifications adds the push entitlement on its own, so take it back out last.
  return withEntitlementsPlist(result, (mod) => {
    delete mod.modResults['aps-environment'];
    delete mod.modResults['com.apple.developer.associated-domains'];
    return mod;
  });
};
