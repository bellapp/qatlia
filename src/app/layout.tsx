import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "QatlIA Pro 2026 — Optimisation de Découpe & Débit IA",
  description: "Solution professionnelle d'optimisation de découpe de panneaux pour menuisiers et artisans. Moteur 2D Guillotine, OCR Vision IA, exports PDF & DXF CNC.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="fr" className={`${inter.variable} ${jetbrainsMono.variable} dark`}>
      <body className="min-h-screen bg-studio-canvas text-slate-100 font-body antialiased selection:bg-brand-500 selection:text-black">
        {children}
      </body>
    </html>
  );
}