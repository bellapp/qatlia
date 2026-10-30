import type { Metadata, Viewport } from "next";
import "../globals.css";
import { ClientShell } from "@/components/ClientShell";
import { AR_DESCRIPTION, AR_TITLE, SITE_NAME } from "@/lib/seo";
import { ar } from "@/i18n/messages/ar";
import { OG_IMAGE, bodyClassName, htmlClassName, sharedMetadata, sharedViewport } from "../site-shell";

export const viewport: Viewport = sharedViewport;

export const metadata: Metadata = {
  ...sharedMetadata,
  title: AR_TITLE,
  description: AR_DESCRIPTION,
  openGraph: {
    type: "website",
    siteName: SITE_NAME,
    title: AR_TITLE,
    description: AR_DESCRIPTION,
    locale: "ar_MA",
    alternateLocale: ["fr_MA"],
    images: [{ ...OG_IMAGE, alt: ar.hero.screenshotAlt }],
  },
};

/**
 * Root layout of the Arabic pages. The language is in the URL, so the HTML is served
 * as lang="ar" dir="rtl" and the stored-preference script of the main layout is left
 * out: it would switch this page to French before it paints.
 */
export default function ArabicRootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ar" dir="rtl" className={htmlClassName} suppressHydrationWarning>
      <body className={bodyClassName}>
        <ClientShell pinnedLocale="ar">{children}</ClientShell>
      </body>
    </html>
  );
}
