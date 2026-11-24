/**
 * Short links the WhatsApp bot sends (src/lib/whatsapp/copy.ts): each opens
 * its page with the WhatsApp tag, so a sign-up is still traced back to the bot
 * (src/lib/acquisition.ts). Temporary (307), so a target can change later.
 */
const WHATSAPP_SHORT_LINKS = [
  { source: '/wa', destination: '/?utm_source=whatsapp' },
  { source: '/wa/ar', destination: '/ar?utm_source=whatsapp' },
  { source: '/wa/atelier', destination: '/atelier?utm_source=whatsapp' },
  { source: '/wa/credits', destination: '/credits?utm_source=whatsapp' },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  async redirects() {
    return WHATSAPP_SHORT_LINKS.map((link) => ({ ...link, permanent: false }));
  },
};

export default nextConfig;
