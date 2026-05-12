/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./client/**/*.{html,ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        green: {
          400: "#4ade80",
          500: "#22c55e",
        },
      },
    },
  },
  plugins: [],
};
