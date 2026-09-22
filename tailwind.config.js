/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        // Neutral, paper-like base for a professional legal tool.
        canvas: '#f6f6f4',
        surface: '#ffffff',
        ink: {
          50: '#f7f7f8',
          100: '#ececee',
          200: '#dcdde0',
          300: '#bcbfc4',
          400: '#8f949c',
          500: '#6b707a',
          600: '#53575f',
          700: '#41454c',
          800: '#2c2f34',
          900: '#1b1d21',
          950: '#111215',
        },
        // Sparse accent used only for navigation and primary actions.
        accent: {
          50: '#f2f5f9',
          100: '#e3e9f2',
          200: '#c8d5e6',
          300: '#9fb3cc',
          400: '#6d89ab',
          500: '#3f6191',
          600: '#2f4d75',
          700: '#273f5e',
          900: '#1a2a3e',
        },
        signal: {
          50: '#fdf7ec',
          100: '#faedd5',
          300: '#e3bd76',
          500: '#b8801f',
          700: '#7f5713',
        },
        flag: {
          50: '#fbf3f2',
          100: '#f6e3e1',
          500: '#9d3b32',
          700: '#71271f',
        },
        positive: {
          50: '#f2f7f3',
          100: '#e0eee4',
          500: '#3f6f4f',
          700: '#2c4f38',
        },
      },
      fontFamily: {
        sans: [
          'Inter',
          'system-ui',
          '-apple-system',
          'Segoe UI',
          'Roboto',
          'Helvetica Neue',
          'Arial',
          'sans-serif',
        ],
        serif: [
          'Iowan Old Style',
          'Palatino Linotype',
          'Palatino',
          'Georgia',
          'Times New Roman',
          'serif',
        ],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
      },
      fontSize: {
        '2xs': ['0.6875rem', { lineHeight: '1rem' }],
      },
      boxShadow: {
        raised: '0 1px 2px rgba(17, 18, 21, 0.06)',
        overlay: '0 12px 32px -12px rgba(17, 18, 21, 0.28)',
      },
      borderRadius: {
        sm: '0.125rem',
        DEFAULT: '0.25rem',
        md: '0.3125rem',
      },
      letterSpacing: {
        label: '0.08em',
      },
    },
  },
  plugins: [],
};
