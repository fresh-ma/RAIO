/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        'sv-bg': '#1a1a2e',
        'sv-bg2': '#16213e',
        'sv-dark': '#0f3460',
        'sv-gold': '#e8b830',
        'sv-gold2': '#c49b1a',
        'sv-teal': '#4ecdc4',
        'sv-green': '#5cb85c',
        'sv-red': '#e74c3c',
        'sv-cream': '#f5e6c8',
        'sv-brown': '#8b6914',
        'sv-panel': '#2a2a4a',
        'sv-panel2': '#3a3a5a',
        'sv-text': '#e8dcc8',
        'sv-text2': '#b8a888',
        'sv-border': '#4a4a6a',
      },
      fontFamily: {
        'pixel': ['"Press Start 2P"', '"Zpix"', 'monospace'],
        'pixel-cn': ['"Zpix"', '"Press Start 2P"', 'monospace'],
      },
      boxShadow: {
        'pixel': '4px 4px 0px #000',
        'pixel-gold': '4px 4px 0px #8b6914',
        'pixel-sm': '2px 2px 0px #000',
      },
      borderWidth: {
        'pixel': '3px',
      },
    },
  },
  plugins: [],
}
