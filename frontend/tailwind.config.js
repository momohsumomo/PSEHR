/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  // Do NOT follow Chrome/OS prefers-color-scheme; only .dark class (which we never set).
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        clinic: {
          allergy: "#b91c1c",
          queue: {
            waiting: "#64748b",
            active: "#16a34a",
            noshow: "#ea580c",
            done: "#94a3b8",
          },
        },
      },
    },
  },
  plugins: [],
};
