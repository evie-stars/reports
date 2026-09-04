/** @type {import('tailwindcss').Config} */
// Shared design tokens with Team Hub: same palette, type, radii, and shadows.
module.exports = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#1E232D", // primary dark (text + dark surfaces)
        inkSoft: "#2A3340", // lighter dark for gradients
        paper: "#F4F6F8", // off-white main panel
        slate: "#5B6672", // muted text
        line: "#E3E7ED", // borders / hairlines
        accent: "#22B07D", // green highlight
        sky: "#4FC3E8", // light-blue highlight
        warn: "#C77B3C", // attention
        blocked: "#C7473C" // failed / danger
      },
      fontFamily: {
        display: ["var(--font-poppins)", "ui-sans-serif", "system-ui", "sans-serif"],
        body: ["var(--font-poppins)", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ['"IBM Plex Mono"', "ui-monospace", "monospace"]
      },
      borderRadius: {
        lg: "0.625rem", // 10px — inputs / buttons
        xl: "0.875rem", // 14px — cards / panels
        "2xl": "1.25rem" // 20px — larger surfaces
      },
      backgroundImage: {
        sidebar: "linear-gradient(180deg, #2A3340 0%, #1E232D 60%, #191D25 100%)"
      },
      boxShadow: {
        soft: "0 1px 2px rgba(16,24,40,0.04), 0 1px 3px rgba(16,24,40,0.05)",
        card: "0 1px 2px rgba(16,24,40,0.04), 0 4px 12px rgba(16,24,40,0.04)",
        lift: "0 10px 28px rgba(16,24,40,0.10), 0 4px 10px rgba(16,24,40,0.05)"
      },
      keyframes: {
        "fade-in-up": {
          "0%": { opacity: "0", transform: "translateY(4px)" },
          "100%": { opacity: "1", transform: "translateY(0)" }
        },
        "grow-up": {
          "0%": { transform: "scaleY(0)" },
          "100%": { transform: "scaleY(1)" }
        }
      },
      animation: {
        "fade-in-up": "fade-in-up 0.25s ease-out both",
        "grow-up": "grow-up 0.45s ease-out both"
      }
    }
  },
  plugins: []
};
