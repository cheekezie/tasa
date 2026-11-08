import type { NextConfig } from 'next';
import path from 'path';

const nextConfig: NextConfig = {
  turbopack: {
    root: path.resolve(__dirname),
    resolveAlias: {
      '@swc/helpers-6be8479ad4112b8f': '@swc/helpers',
    },
  },
  images: {
    // Placeholder photography until Tasa's own replaces it.
    // Object form, not `new URL(...)`: a URL pattern's empty query would reject Pexels' `?auto=…&w=…` sizing.
    remotePatterns: [{ protocol: 'https', hostname: 'images.pexels.com', pathname: '/photos/**' }],
  },
  async headers() {
    return [
      {
        // Apple fetches this without an extension and needs it served as JSON.
        source: '/.well-known/apple-app-site-association',
        headers: [{ key: 'Content-Type', value: 'application/json' }],
      },
    ];
  },
};

export default nextConfig;
