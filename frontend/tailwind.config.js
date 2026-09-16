/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        stellar: {
          50: '#eef9ff',
          100: '#d9f0ff',
          200: '#bce6ff',
          300: '#8ed8ff',
          400: '#59c2ff',
          500: '#33aaff',
          600: '#1c8cf5',
          700: '#1473e1',
          800: '#175cb6',
          900: '#194e90',
          950: '#143157',
        },
        ink: '#0b1e33',
        canvas: '#f6f8fb',
      },
      fontFamily: {
        display: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'monospace'],
      },
      boxShadow: {
        card: '0 1px 3px rgba(11,30,51,0.06), 0 8px 24px rgba(11,30,51,0.08)',
      },
    },
  },
  plugins: [],
};