import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        display: ['"Space Grotesk"', 'ui-sans-serif', 'system-ui'],
        body: ['"Space Grotesk"', 'ui-sans-serif', 'system-ui'],
      },
      colors: {
        ink: '#0b1021',
        sakura: '#f552b9',
        aurora: '#21d4fd',
        coin: '#f6d365',
      },
      boxShadow: {
        glow: '0 0 30px rgba(245,82,185,0.35)',
      },
    },
  },
  plugins: [],
};

export default config;
