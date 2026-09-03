import type { Config } from 'tailwindcss';

/**
 * The palette is defined once, in CSS custom properties (src/styles/index.css),
 * and referenced here. Nothing outside it: no pure black, no pure white, no
 * blue, no modern accent colours.
 */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    // Replacing rather than extending, so a stray `bg-blue-500` fails loudly
    // instead of quietly putting a modern accent colour on the parchment.
    colors: {
      transparent: 'transparent',
      current: 'currentColor',
      parchment: 'var(--parchment)',
      'parchment-deep': 'var(--parchment-deep)',
      ink: 'var(--ink)',
      'ink-faded': 'var(--ink-faded)',
      sepia: 'var(--sepia-wash)',
      ember: 'var(--ember)',
      wood: 'var(--wood)',
      'wood-deep': 'var(--wood-deep)',
    },
    fontFamily: {
      // The map's own voice.
      hand: ['"IM Fell English"', '"IM Fell DW Pica"', 'Georgia', 'serif'],
      // Interface copy that has to be read quickly.
      ui: ['"Crimson Pro"', 'Georgia', 'serif'],
    },
    fontSize: {
      xs: ['0.75rem', { lineHeight: '1.15rem' }],
      sm: ['0.875rem', { lineHeight: '1.35rem' }],
      base: ['1rem', { lineHeight: '1.55rem' }],
      lg: ['1.125rem', { lineHeight: '1.6rem' }],
      xl: ['1.375rem', { lineHeight: '1.75rem' }],
      '2xl': ['1.75rem', { lineHeight: '2.05rem' }],
      '3xl': ['2.25rem', { lineHeight: '2.5rem' }],
      '4xl': ['3rem', { lineHeight: '3.15rem' }],
    },
    extend: {
      borderRadius: { seal: '0.35rem' },
      transitionTimingFunction: {
        quill: 'cubic-bezier(0.22, 0.61, 0.36, 1)',
      },
    },
  },
  plugins: [],
} satisfies Config;
