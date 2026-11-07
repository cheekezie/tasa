# Tasa website

The public site for Tasa: the landing page (features, how it works, why Tasa, FAQ, store links)
and the landing page for group invite links, `/g/:code`.

## Invite links

`https://<site>/g/CODE` is the link the app shares. With Tasa installed, iOS (Universal Links)
and Android (App Links) open the app straight to the join screen. Otherwise this site shows the
group's name and picture (from the API's public preview), the code, and the store buttons.

For the OS to hand these links to the app, this site serves:

- `/.well-known/apple-app-site-association`, from `IOS_APP_ID` (Team ID + bundle ID)
- `/.well-known/assetlinks.json`, from `ANDROID_PACKAGE` and `ANDROID_SHA256_FINGERPRINTS`

Both answer 404 until those are set. The app declares the same domain (`EXPO_PUBLIC_SITE_URL` in
the app's `app.config.ts`).

## Setup

```bash
cp .env.example .env.local   # fill in the store URLs and app identifiers
npm install
npm run dev
```

Photos are Pexels placeholders, listed in `src/lib/site.ts` (`photos`). Replace them there.
