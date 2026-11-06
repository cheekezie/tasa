import { appLinks } from '@/lib/site';

/**
 * Android App Links: proves this domain belongs to the Tela app, so links open it without asking
 * "open with…". The fingerprints are the app's signing certificates (Play App Signing).
 */
export function GET() {
  if (!appLinks.androidPackage || appLinks.androidFingerprints.length === 0) return new Response('Not configured', { status: 404 });
  return Response.json(
    [
      {
        relation: ['delegate_permission/common.handle_all_urls'],
        target: { namespace: 'android_app', package_name: appLinks.androidPackage, sha256_cert_fingerprints: appLinks.androidFingerprints },
      },
    ],
    { headers: { 'Cache-Control': 'public, max-age=3600' } },
  );
}
