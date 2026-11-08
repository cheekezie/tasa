import { appLinks } from '@/lib/site';

/**
 * Universal Links: iOS fetches this when Tasa is installed to learn which links on this domain
 * the app opens. Only invite links (`/g/*`); everything else stays on the website.
 */
export function GET() {
  if (!appLinks.iosAppId) return new Response('Not configured', { status: 404 });
  return Response.json(
    { applinks: { details: [{ appIDs: [appLinks.iosAppId], components: appLinks.paths.map((path) => ({ '/': path })) }] } },
    { headers: { 'Cache-Control': 'public, max-age=3600' } },
  );
}
