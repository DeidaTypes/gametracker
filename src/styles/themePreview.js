/**
 * Theme preview tiles for the Appearance screen (TH-03).
 *
 * Display order is fixed. `mode` is dark or light. The five colors are
 * the page background, the card surface, and the three roles: app,
 * reviews, and lists. Full palettes live in theme.css. This file is
 * allowed to hold color values; components must not.
 *
 * Navy's five colors match both the shipping theme and the mockup.
 * Navy keeps four other colors that the mockup drifted from (surface-2,
 * line, dim, gold). Those are not on the preview tile.
 */

export const THEME_ORDER = Object.freeze([
  'navy',
  'black',
  'forest',
  'purple',
  'light',
  'sky',
  'pink',
  'cream',
])

export const THEMES = Object.freeze({
  navy: {
    id: 'navy',
    name: 'Navy',
    mode: 'dark',
    base: '#0a0f1f',
    surface: '#131a35',
    primary: '#3b82f6',
    review: '#0a9e6a',
    journal: '#8b32d1',
  },
  black: {
    id: 'black',
    name: 'Black',
    mode: 'dark',
    base: '#000000',
    surface: '#0f0f11',
    primary: '#4a78ff',
    review: '#0f9d6b',
    journal: '#9a45e8',
  },
  forest: {
    id: 'forest',
    name: 'Dark Green',
    mode: 'dark',
    base: '#08140f',
    surface: '#0f2119',
    primary: '#22b07d',
    review: '#c2d856',
    journal: '#a98bf0',
  },
  purple: {
    id: 'purple',
    name: 'Purple',
    mode: 'dark',
    base: '#110a1d',
    surface: '#1c1230',
    primary: '#7a55f5',
    review: '#0f9985',
    journal: '#d4478f',
  },
  light: {
    id: 'light',
    name: 'Light',
    mode: 'light',
    base: '#f4f6fa',
    surface: '#ffffff',
    primary: '#2563eb',
    review: '#067a55',
    journal: '#7c3aed',
  },
  sky: {
    id: 'sky',
    name: 'Light Blue',
    mode: 'light',
    base: '#cfe2f6',
    surface: '#eaf3fd',
    primary: '#1a64cc',
    review: '#0b8066',
    journal: '#5b47d6',
  },
  pink: {
    id: 'pink',
    name: 'Light Pink',
    mode: 'light',
    base: '#f5d3de',
    surface: '#fcecf1',
    primary: '#c92a62',
    review: '#0d8069',
    journal: '#7446cf',
  },
  cream: {
    id: 'cream',
    name: 'Cream',
    mode: 'light',
    base: '#e8dcc2',
    surface: '#f7efdf',
    primary: '#2c5b8a',
    review: '#3a7648',
    journal: '#86427f',
  },
})

export function getTheme(id) {
  return THEMES[id] || THEMES.navy
}
