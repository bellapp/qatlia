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
        // Channels + <alpha-value>, so `bg-studio-panel/60` and friends compile.
        // A bare `var(--…)` color silently drops every opacity variant.
        studio: {
          canvas: 'rgb(var(--color-canvas) / <alpha-value>)',
          panel: 'rgb(var(--color-panel) / <alpha-value>)',
          field: 'rgb(var(--color-field) / <alpha-value>)',
          border: 'rgb(var(--color-border) / <alpha-value>)',
          'border-hover': 'rgb(var(--color-border-hover) / <alpha-value>)',
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
        // next/font exposes Inter as `--font-inter` (see src/app/site-shell.ts).
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