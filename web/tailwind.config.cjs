/** @type {import('tailwindcss').Config} */
module.exports = {
  // Tailwind 3 (web/PostCSS); keep aligned with the Tailwind 4 embed variant.
  darkMode: ['variant', '&:where([data-theme="dark"], [data-theme="dark"] *, :host([data-theme="dark"]) *)'],
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
    "../ui/src/**/*.{js,ts,jsx,tsx}"
  ],
  theme: {
    extend: {},
  },
  plugins: [],
}
