import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      screens: {
        xs: '400px',
      },
      colors: {
        background: "var(--background)",
        foreground: "var(--foreground)",
        studio: {
          canvas: 'var(--color-canvas)',
          panel: 'var(--color-panel)',
          field: 'var(--color-field)',
          border: 'var(--color-border)',
          'border-hover': 'var(--color-border-hover)',
        },
        brand: {
          // QatlIA MIX per Stitch DESIGN.md: amber-500 #F5A623 is THE primary;
          // hover #D9860F; tint #FEF3E2 for soft backgrounds.
          300: '#FEF3E2',
          400: '#F5A623',
          500: '#D9860F',
          600: '#B8720C',
        },
      },
      fontFamily: {
        // next/font exposes Inter as `--font-inter` (see src/app/layout.tsx).
        // Without the variable the stack fell through to the generic sans-serif.
        display: ['var(--font-inter)', 'Inter', 'sans-serif'],
        body: ['var(--font-inter)', 'Inter', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'monospace'],
      },
    },
  },
  plugins: [],
};
export default config;