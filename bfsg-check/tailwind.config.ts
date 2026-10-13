import type { Config } from "tailwindcss";

// Farben: Kontraste gegen Weiß geprüft (WCAG 2.2 AA, Text ≥ 4.5:1).
//   navy-900 #0b1b3a  → 17.6:1      primary-700 #1d4ed8 → 6.7:1
//   navy-600 #3b4a6b  →  8.6:1      navy-500 #51607f    →  6.3:1
const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        navy: {
          50: "#f4f6fb",
          100: "#e8ecf5",
          200: "#d3dae9",
          300: "#b3bfd8",
          500: "#51607f",
          600: "#3b4a6b",
          800: "#14284f",
          900: "#0b1b3a",
        },
        primary: {
          50: "#eff4ff",
          100: "#dbe6fe",
          600: "#2563eb",
          700: "#1d4ed8",
          800: "#1e40af",
        },
      },
      fontFamily: {
        sans: ["system-ui", "-apple-system", "Segoe UI", "Roboto", "Helvetica Neue", "Arial", "sans-serif"],
      },
      maxWidth: { prose: "68ch" },
    },
  },
  plugins: [],
};
export default config;
