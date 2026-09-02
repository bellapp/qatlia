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
          300: '#FFD08C',
          400: '#F5A623',
          500: '#E09612',
          600: '#C47F0A',
        },
      },
      fontFamily: {
        display: ['Inter', 'sans-serif'],
        body: ['Inter', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'monospace'],
      },
    },
  },
  plugins: [],
};
export default config;