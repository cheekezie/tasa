import type { MetadataRoute } from 'next';

import { site } from '@/lib/site';

export default function robots(): MetadataRoute.Robots {
  // Invite links are private to whoever they were sent to.
  return { rules: [{ userAgent: '*', allow: '/', disallow: '/g/' }], sitemap: `${site.url}/sitemap.xml` };
}
