/**
 * Stylelint — WARNING MODE.
 *
 * Every rule here is `severity: 'warning'` on purpose. Nothing in this
 * config fails a build today; the goal of this first pass is to make the
 * existing drift visible and to stop new drift from going unnoticed in
 * review. Once the backlog is worked down, individual rules can be
 * promoted to errors (drop the `severity` override) and `npm run lint`
 * can be gated in CI with `--max-warnings 0`.
 *
 * Deliberately NOT extending stylelint-config-standard: that would bury
 * the two signals we actually care about under thousands of stylistic
 * warnings. Only the two design-system invariants are enforced:
 *
 *   1. Spacing must sit on the 4px grid (src/styles/tokens.css).
 *   2. No hardcoded hex outside the token files — with the retired
 *      orange/amber/copper palette called out explicitly.
 */

/**
 * Matches any px length that is NOT on the spacing scale.
 *
 * On-scale: 0, 2 (restricted hairline), 4, 8, 12, 16, 20, 24, 32, 40,
 * 48, 64 — see src/styles/tokens.css.
 *
 * The lookbehind anchors the match to the start of a number so "4px"
 * inside "14px" isn't mistaken for the allowed step, and the negative
 * lookahead lets on-scale values through. Applied only to spacing
 * properties, so border widths, font sizes, and transforms are
 * untouched.
 */
const OFF_SCALE_PX =
  '/(?<![\\d.])(?!(?:0|2|4|8|12|16|20|24|32|40|48|64)px\\b)\\d+(?:\\.\\d+)?px/'

const OFF_SCALE_MESSAGE =
  'Off-scale spacing value. Use a --space-* token from src/styles/tokens.css (4px grid: 4/8/12/16/20/24/32/40/48/64, plus --space-2 for inline icon-to-text gaps only).'

module.exports = {
  plugins: ['./scripts/stylelint/no-retired-palette.cjs'],

  ignoreFiles: [
    '**/node_modules/**',
    'dist/**',
    'ios/**',
    'public/**',
    'api/**',
  ],

  rules: {
    // ---- 1. Spacing must be on the 4px grid ----
    'declaration-property-value-disallowed-list': [
      {
        '/^(margin|padding|gap|row-gap|column-gap|inset)/': [OFF_SCALE_PX],
        '/^(top|right|bottom|left)$/': [OFF_SCALE_PX],
      },
      { severity: 'warning', message: OFF_SCALE_MESSAGE },
    ],

    // ---- 2a. No hardcoded hex outside the token files ----
    'color-no-hex': [
      true,
      {
        severity: 'warning',
        message:
          'Hardcoded hex color. Use a token from src/styles/theme.css; add a new token there if none fits.',
      },
    ],

    // ---- 2b. …and specifically not the retired warm palette ----
    'gametracker/no-retired-palette': [true, { severity: 'warning' }],
  },

  overrides: [
    {
      // The token files are where hex literals are SUPPOSED to live —
      // they define the palette that every other file consumes.
      files: ['src/styles/theme.css', 'src/styles/tokens.css'],
      rules: {
        'color-no-hex': null,
        'gametracker/no-retired-palette': null,
      },
    },
    {
      // Fixed-canvas capture targets (1080x1350 / 1080x1920) rasterised
      // by html-to-image. Their geometry is absolute by design and does
      // not belong on the app's 4px grid — see the --share-* block in
      // src/styles/theme.css.
      files: [
        'src/components/BrandedShareCard.css',
        'src/components/celebration/ShareCard.css',
      ],
      rules: {
        'declaration-property-value-disallowed-list': null,
      },
    },
  ],
}
