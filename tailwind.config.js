/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx,ts,tsx}"],
  theme: {
    extend: {
      colors: {
        space: { 950: "#05070f", 900: "#0a0f1f", 800: "#111933", 700: "#1a2547" },
        nasa: { blue: "#0b3d91", red: "#fc3d21", cyan: "#22d3ee" },
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "Segoe UI", "Roboto", "sans-serif"],
        mono: ["JetBrains Mono", "ui-monospace", "monospace"],
      },
      boxShadow: { glow: "0 0 24px rgba(34,211,238,0.25)" },
    },
  },
  plugins: [],
};
