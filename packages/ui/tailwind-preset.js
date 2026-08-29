/**
 * Preset Tailwind do Design System MedConsultoria (ver docs/UI_GUIDELINES.md).
 * Cores da marca em hex; tokens semânticos (shadcn) mapeados para CSS variables
 * definidas em apps/web/src/index.css — assim o app inteiro re-tematiza por variável.
 */

/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ["class"],
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: { "2xl": "1400px" },
    },
    extend: {
      colors: {
        // Paleta da marca (uso direto: bg-brand-green, text-brand-blueText, ...)
        brand: {
          green: "#30AD73",
          blueLight: "#2DA8E1",
          blueDark: "#002463",
          blueText: "#003591",
        },
        // Tokens semânticos (shadcn) — valores vêm das CSS variables.
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        success: {
          DEFAULT: "hsl(var(--success))",
          foreground: "hsl(var(--success-foreground))",
        },
        warning: {
          DEFAULT: "hsl(var(--warning))",
          foreground: "hsl(var(--warning-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        sidebar: {
          DEFAULT: "hsl(var(--sidebar))",
          foreground: "hsl(var(--sidebar-foreground))",
        },
      },
      borderRadius: {
        xl: "calc(var(--radius) + 4px)",
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      fontFamily: {
        sans: ["Montserrat", "system-ui", "sans-serif"],
      },
      boxShadow: {
        sm: "var(--shadow-sm)",
        DEFAULT: "var(--shadow)",
        md: "var(--shadow-md)",
        lg: "var(--shadow-lg)",
      },
      keyframes: {
        "fade-in": {
          from: { opacity: "0" },
          to: { opacity: "1" },
        },
        "scale-in": {
          from: { opacity: "0", transform: "translateY(6px) scale(0.98)" },
          to: { opacity: "1", transform: "translateY(0) scale(1)" },
        },
        "slide-down": {
          from: { opacity: "0", transform: "translateY(-6px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        "slide-in-right": {
          from: { transform: "translateX(-100%)" },
          to: { transform: "translateX(0)" },
        },
        "slide-in-panel": {
          from: { transform: "translateX(100%)" },
          to: { transform: "translateX(0)" },
        },
        "slide-in-bottom": {
          from: { transform: "translateY(100%)" },
          to: { transform: "translateY(0)" },
        },
      },
      animation: {
        "fade-in": "fade-in 0.15s ease-out",
        "scale-in": "scale-in 0.16s cubic-bezier(0.16, 1, 0.3, 1)",
        "slide-down": "slide-down 0.16s ease-out",
        "slide-in-right": "slide-in-right 0.2s cubic-bezier(0.16, 1, 0.3, 1)",
        "slide-in-panel": "slide-in-panel 0.22s cubic-bezier(0.16, 1, 0.3, 1)",
        // Painel do Sheet quando `lado="baixo"` (padrão no celular) — mesmo gesto do
        // `slide-in-panel` (borda → dentro), só que a partir de baixo.
        "slide-in-bottom": "slide-in-bottom 0.22s cubic-bezier(0.16, 1, 0.3, 1)",
      },
    },
  },
};
