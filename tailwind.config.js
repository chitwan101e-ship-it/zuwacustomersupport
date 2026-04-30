/** @type {import('tailwindcss').Config} */
module.exports = {
  // Scan all of src so route groups like app/(auth)/... are always included (fixes missing Tailwind output).
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#eef4ff',
          100: '#dbe8ff',
          300: '#8fb4ff',
          500: '#1a56e8',
          600: '#1344cc',
        },
      },
      fontFamily: {
        display: ['Inter', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
