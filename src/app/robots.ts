import type { MetadataRoute } from 'next';
import { PRIVATE_ROUTES, SITE_URL } from '@/lib/seo';

// Search engines and AI crawlers (GPTBot, PerplexityBot, ClaudeBot, Google-Extended…) all
// follow the `*` group: the public pages are open to every one of them on purpose.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: '*', allow: '/', disallow: [...PRIVATE_ROUTES] },
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
