import type { Metadata, Viewport } from "next";
import "../globals.css";
import { ClientShell } from "@/components/ClientShell";
import { DEFAULT_LOCALE, dirFor, localeInitScript } from "@/i18n";
import { SITE_DESCRIPTION, SITE_NAME } from "@/lib/seo";
import { storeAppInitScript } from "@/lib/store-app";
import { OG_IMAGE, bodyClassName, htmlClassName, sharedMetadata, sharedViewport } from "../site-shell";

export const viewport: Viewport = sharedViewport;

const TITLE = "QatliA — Optimisation de Découpe & Débit IA pour Menuisiers";

export const metadata: Metadata = {
  ...sharedMetadata,
  title: TITLE,
  description: SITE_DESCRIPTION,
  openGraph: {
    type: "website",
    siteName: SITE_NAME,
    title: TITLE,
    description: SITE_DESCRIPTION,
    locale: "fr_MA",
    images: [{ ...OG_IMAGE, alt: "Plan de découpe optimisé dans l'atelier QatliA" }],
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang={DEFAULT_LOCALE} dir={dirFor(DEFAULT_LOCALE)} className={htmlClassName} suppressHydrationWarning>
      <body className={bodyClassName}>
        {/* Inside the Play Store app: hides what sells and leaves a purchase page before it paints. */}
        <script dangerouslySetInnerHTML={{ __html: storeAppInitScript }} />
        {/* Corrects lang/dir from the persisted preference before the page paints. */}
        <script dangerouslySetInnerHTML={{ __html: localeInitScript }} />
        <ClientShell>{children}</ClientShell>
      </body>
    </html>
  );
}
