import type { MetadataRoute } from "next";

import { site } from "@/lib/site";

export default function robots(): MetadataRoute.Robots {
  // Invite links and receipts are private to whoever they were sent to.
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/g/", "/r/"] }],
    sitemap: `${site.url}/sitemap.xml`,
  };
}
