/* eslint-disable */
/**
 * Generates src/assets/lottie/celebration.json — a minimal warm-amber
 * confetti / sparks animation. Hand-rolling Lottie JSON is error-prone
 * so we generate it deterministically here. Run once with:
 *
 *   node scripts/build-celebration-lottie.cjs
 *
 * Particles fall from the top of the 1080×1920 frame toward the cover
 * (anchored vertically to ~840px), with stagger + rotation. Palette is
 * warm amber/gold only — no rainbow.
 */

const fs = require('fs');
const path = require('path');

const W = 1080;
const H = 1920;
const FR = 60;
const DURATION_S = 2.4;
const OP = Math.round(FR * DURATION_S);

const PALETTE = [
  // RGBA in [0,1] — warm amber spectrum, brand tokens with light variants
  [0.784, 0.588, 0.353, 1], // #C8965A brand-primary
  [0.910, 0.769, 0.604, 1], // #E8C49A brand-secondary
  [0.631, 0.447, 0.212, 1], // #A17236 brand-primary-dark
  [0.965, 0.890, 0.741, 1], // soft cream
];

const PARTICLE_COUNT = 28;

function rand(seed) {
  // Deterministic PRNG so the JSON is byte-stable across runs.
  let x = Math.sin(seed) * 10000;
  return x - Math.floor(x);
}

function makeParticle(i) {
  const startX = rand(i * 7.13) * W;
  const driftX = (rand(i * 1.7) - 0.5) * 220;
  const endY = 1000 + rand(i * 3.1) * 540;
  const startDelay = Math.floor(rand(i * 5.31) * (OP * 0.5));
  const fallDuration = Math.floor((OP - startDelay) * (0.6 + rand(i * 9.2) * 0.4));
  const rotStart = Math.floor(rand(i * 2.7) * 360);
  const rotEnd = rotStart + (rand(i * 4.4) > 0.5 ? 1 : -1) * (180 + rand(i * 6.8) * 540);
  const size = 10 + Math.floor(rand(i * 11.7) * 14);
  const isStrip = rand(i * 13.9) > 0.55;
  const stripH = isStrip ? size * 0.45 : size;
  const color = PALETTE[i % PALETTE.length];
  const opacityPeak = 70 + Math.floor(rand(i * 15.1) * 25);

  return {
    ddd: 0,
    ind: i + 1,
    ty: 4, // shape layer
    nm: `p${i}`,
    sr: 1,
    ks: {
      o: {
        // Fade in fast, hold, fade out at the bottom
        a: 1,
        k: [
          { t: startDelay, s: [0] },
          { t: startDelay + 6, s: [opacityPeak] },
          { t: startDelay + fallDuration - 18, s: [opacityPeak] },
          { t: startDelay + fallDuration, s: [0] },
        ],
      },
      r: {
        a: 1,
        k: [
          { t: startDelay, s: [rotStart] },
          { t: startDelay + fallDuration, s: [rotEnd] },
        ],
      },
      p: {
        a: 1,
        k: [
          {
            t: startDelay,
            s: [startX, -40, 0],
            // ease out so particles slow as they near the cover
            o: { x: [0.25], y: [0] },
            i: { x: [0.6], y: [1] },
            ti: [0, 0, 0],
            to: [driftX / 3, (endY + 40) / 3, 0],
          },
          {
            t: startDelay + fallDuration,
            s: [startX + driftX, endY, 0],
          },
        ],
      },
      a: { a: 0, k: [0, 0, 0] },
      s: { a: 0, k: [100, 100, 100] },
    },
    ao: 0,
    shapes: [
      {
        ty: 'gr',
        it: [
          {
            ty: 'rc',
            d: 1,
            s: { a: 0, k: [size, stripH] },
            p: { a: 0, k: [0, 0] },
            r: { a: 0, k: stripH * 0.4 },
            nm: 'rect',
          },
          {
            ty: 'fl',
            c: { a: 0, k: color },
            o: { a: 0, k: 100 },
            r: 1,
            bm: 0,
            nm: 'fill',
          },
          {
            ty: 'tr',
            p: { a: 0, k: [0, 0] },
            a: { a: 0, k: [0, 0] },
            s: { a: 0, k: [100, 100] },
            r: { a: 0, k: 0 },
            o: { a: 0, k: 100 },
            sk: { a: 0, k: 0 },
            sa: { a: 0, k: 0 },
            nm: 'tr',
          },
        ],
        nm: 'particle-shape',
      },
    ],
    ip: 0,
    op: OP,
    st: 0,
    bm: 0,
  };
}

const layers = [];
for (let i = 0; i < PARTICLE_COUNT; i++) layers.push(makeParticle(i));

const lottie = {
  v: '5.7.4',
  fr: FR,
  ip: 0,
  op: OP,
  w: W,
  h: H,
  nm: 'celebration',
  ddd: 0,
  assets: [],
  layers,
  meta: { g: 'GameTracker celebration v1' },
};

const outPath = path.join(__dirname, '..', 'src', 'assets', 'lottie', 'celebration.json');
fs.writeFileSync(outPath, JSON.stringify(lottie));
console.log('wrote', outPath, JSON.stringify(lottie).length, 'bytes');
