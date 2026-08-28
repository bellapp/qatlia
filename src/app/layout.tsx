import type { Metadata } from "next";
import "./globals.css";
import "../../public/styles.css";

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
    <html lang="fr" className="dark">
      <body className="min-h-screen bg-[#070C18] text-slate-100 font-sans antialiased selection:bg-amber-500 selection:text-black">
        {children}
      </body>
    </html>
  );
}
