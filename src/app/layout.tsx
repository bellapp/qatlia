import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { ThemeProvider } from "@/components/ThemeProvider";
import { PwaShell } from "@/components/PwaShell";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
const jetbrainsMono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono", display: "swap" });

export const metadata: Metadata = {
  title: "QatlIA Pro — Optimisation de Découpe & Débit IA",
  description: "Solution professionnelle d'optimisation de découpe de panneaux pour menuisiers et artisans. Moteur 2D Guillotine, OCR Vision IA, exports PDF & DXF CNC.",
  manifest: "/manifest.json",
  appleWebApp: { capable: true, title: "QatlIA", statusBarStyle: "black-translucent" },
};

export const viewport: Viewport = { themeColor: "#F5A623" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr" className={`${inter.variable} ${jetbrainsMono.variable}`} suppressHydrationWarning>
      <body className="min-h-screen bg-studio-canvas text-slate-700 dark:text-slate-100 font-body antialiased selection:bg-brand-500 selection:text-black">
        <ThemeProvider><PwaShell>{children}</PwaShell></ThemeProvider>
      </body>
    </html>
  );
}