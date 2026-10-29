import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import { SITE_URL } from "@/lib/seo";

/**
 * What both root layouts share. `/ar` has its own root layout (route group `(ar)`)
 * so its <html> is served as lang="ar" dir="rtl" in the initial HTML; a root
 * layout inherits nothing, so the fonts, icons and base URL live here once.
 */

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
const jetbrainsMono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono", display: "swap" });

export const htmlClassName = `${inter.variable} ${jetbrainsMono.variable}`;

export const bodyClassName =
  "min-h-screen bg-studio-canvas text-slate-700 dark:text-slate-100 font-body antialiased selection:bg-brand-400 selection:text-black";

export const OG_IMAGE = { url: "/hero-atelier.webp", width: 810, height: 770 };

export const sharedMetadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  manifest: "/manifest.json",
  icons: {
    icon: [
      { url: "/icon.svg", type: "image/svg+xml" },
      { url: "/favicon.png", type: "image/png", sizes: "32x32" },
    ],
    apple: "/apple-touch-icon.png",
  },
  appleWebApp: { capable: true, title: "QatliA", statusBarStyle: "black-translucent" },
};

export const sharedViewport: Viewport = { themeColor: "#F5A623" };
