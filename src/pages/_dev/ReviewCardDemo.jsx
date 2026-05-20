import React from 'react'
import ReviewCard from '../../components/ReviewCard'

/**
 * Dev-only visual harness for ReviewCard. Mounted at /_dev/review-card
 * when import.meta.env.DEV is true. Each card exercises a distinct
 * combination of variant / cover-color / pill state so the full matrix
 * is visible at a glance.
 *
 * Cover URLs use seeded picsum.photos images — they're CORS-friendly
 * (so node-vibrant can extract a swatch) and each seed yields a stable,
 * visually distinct image so the gradient reads differently on each
 * card. If extraction fails, the component falls back to its default
 * muted-navy gradient — verified by setting an obviously-broken URL on
 * the first card during initial development.
 */
function makeBody(repeats) {
  // Long enough to overflow a 5-line clamp at typical card widths.
  return Array(repeats)
    .fill(
      'This game completely reframes what an action RPG can feel like — every encounter forces a decision, every system rewards patience, and the world keeps pulling me back even after the credits.'
    )
    .join(' ')
}

const SAMPLE_REVIEWS = [
  {
    id: 'demo-1',
    title: 'A genre-defining masterpiece',
    body: makeBody(4),
    rating: 4.5,
    author: {
      username: 'amelia',
      displayName: 'Amelia',
      avatarUrl: 'https://i.pravatar.cc/64?img=47',
    },
    game: {
      id: '1942',
      name: 'Resident Outlaw: Burning Skies',
      developer: 'Crimson Forge Studios',
      coverUrl: 'https://picsum.photos/seed/sunsetfire/300/450',
    },
    likeCount: 124,
    commentCount: 8,
    createdAt: '2026-04-12T14:33:00Z',
  },
  {
    id: 'demo-2',
    body: 'Tight, focused, and over before it overstays its welcome. Loved every minute.',
    rating: 4.0,
    author: {
      username: 'kenji',
      displayName: 'Kenji',
      avatarUrl: 'https://i.pravatar.cc/64?img=12',
    },
    game: {
      id: '2188',
      name: 'Tidefall',
      developer: 'Northwave Interactive',
      coverUrl: 'https://picsum.photos/seed/oceanteal/300/450',
    },
    likeCount: 42,
    commentCount: 3,
    createdAt: '2026-04-15T09:10:00Z',
  },
  {
    id: 'demo-3',
    title: 'Compact card preview',
    body: makeBody(3),
    rating: 3.5,
    author: {
      username: 'rho',
      displayName: 'Rho',
      avatarUrl: 'https://i.pravatar.cc/64?img=23',
    },
    game: {
      id: '3001',
      name: 'Lavender Drift',
      developer: 'Pale Moth',
      coverUrl: 'https://picsum.photos/seed/violetbloom/300/450',
    },
    likeCount: 18,
    commentCount: 0,
    createdAt: '2026-04-20T18:00:00Z',
  },
  {
    id: 'demo-4',
    title: 'Your take on the year so far',
    body: makeBody(2),
    rating: 5.0,
    author: {
      username: 'you',
      displayName: 'You',
      avatarUrl: 'https://i.pravatar.cc/64?img=68',
    },
    game: {
      id: '4117',
      name: 'Black Iron Protocol',
      developer: 'Underlight Games',
      coverUrl: 'https://picsum.photos/seed/midnightcoal/300/450',
    },
    likeCount: 7,
    commentCount: 1,
    createdAt: '2026-05-01T22:45:00Z',
  },
]

function Section({ label, children }) {
  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div
        style={{
          fontSize: 11,
          fontWeight: 600,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          color: 'var(--color-text-tertiary)',
        }}
      >
        {label}
      </div>
      {children}
    </section>
  )
}

export default function ReviewCardDemo() {
  return (
    <div
      style={{
        maxWidth: 560,
        margin: '0 auto',
        padding: 'var(--spacing-xl) var(--page-padding)',
        paddingBottom: 'var(--bottom-nav-safe-area)',
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--spacing-xl)',
      }}
    >
      <header style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <h1
          style={{
            fontFamily: 'var(--font-serif)',
            fontSize: 28,
            margin: 0,
            color: 'var(--color-text-primary)',
          }}
        >
          ReviewCard — visual harness
        </h1>
        <p
          style={{
            margin: 0,
            color: 'var(--color-text-secondary)',
            fontSize: 14,
          }}
        >
          Dev-only. Mounted behind <code>import.meta.env.DEV</code>. Verifies
          all six sections render in order, the cover-header gradient picks
          up the dominant cover color, and like state persists across reload.
        </p>
      </header>

      <Section label="Default · long body · warm cover · Read more">
        <ReviewCard review={SAMPLE_REVIEWS[0]} />
      </Section>

      <Section label="Default · short body · cool cover · no Read more">
        <ReviewCard review={SAMPLE_REVIEWS[1]} />
      </Section>

      <Section label="Compact · 3-line clamp · no Read more">
        <ReviewCard review={SAMPLE_REVIEWS[2]} variant="compact" />
      </Section>

      <Section label="With Your-review pill · dark cover (contrast check)">
        <ReviewCard review={SAMPLE_REVIEWS[3]} showOwnPill />
      </Section>
    </div>
  )
}
