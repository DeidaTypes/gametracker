/**
 * BrandedShareCard — offscreen card rendered by share.js / captureCard().
 *
 * Variants:
 *   profile-dna       Gamer DNA card (F2, 1080×1350, Cobalt Modern)
 *   game-score        (future)
 *   favorites-shelf   (future)
 *   quotable-review   (future)
 *
 * Contract:
 *   - All styles are INLINE so html-to-image captures them correctly.
 *   - Props: { variant, data, deepLinkUrl, qrDataUrl, onReady }
 *   - onReady() is called after the component mounts and images resolve.
 */

import React, { useEffect, useRef, useState } from 'react'
import { CARD_WIDTH, CARD_HEIGHT } from '../services/share'

// ── Cobalt Modern palette (inlined — no CSS variable resolution in raster) ───
const C = {
  bgBase:     '#0a0f1f',
  bgSurface:  '#131a35',
  bgSurface2: '#1a2240',
  accent:     '#3b82f6',
  accentMid:  '#60a5fa',
  textPrimary:'#f0f3fa',
  textSecond: '#94a8d4',
  textTert:   '#5c6b8a',
  borderSub:  'rgba(148,168,212,0.12)',
  borderStr:  'rgba(148,168,212,0.24)',
  success:    '#34d399',
  warning:    '#fbbf24',
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function barWidth(pct) {
  return Math.max(6, Math.min(100, pct)) + '%'
}

function fmtHours(h) {
  if (!h) return '0h'
  if (h >= 1000) return `${(h / 1000).toFixed(1)}k h`
  return `${h}h`
}

function starStr(avg) {
  if (avg === null || avg === undefined) return '—'
  return avg.toFixed(1) + '★'
}

// ── Checkpoint wordmark SVG (inline, no external assets) ─────────────────────
function CheckpointMark({ size = 24 }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <rect width="24" height="24" rx="6" fill={C.accent} />
      <path
        d="M6 12 L10 16 L18 8"
        stroke={C.textPrimary}
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

// ── Bar chart row ─────────────────────────────────────────────────────────────
function GenreBar({ name, pct, accent, surface, textPrimary, textSecond }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        marginBottom: 8,
        alignItems: 'baseline',
      }}>
        <span style={{
          fontSize: 26,
          fontWeight: 600,
          color: textPrimary,
          fontFamily: "'DM Sans', system-ui, sans-serif",
          letterSpacing: '-0.01em',
        }}>
          {name}
        </span>
        <span style={{
          fontSize: 24,
          fontWeight: 500,
          color: textSecond,
          fontFamily: "'DM Sans', system-ui, sans-serif",
        }}>
          {pct}%
        </span>
      </div>
      <div style={{
        height: 10,
        backgroundColor: surface,
        borderRadius: 5,
        overflow: 'hidden',
      }}>
        <div style={{
          height: '100%',
          width: barWidth(pct),
          backgroundColor: accent,
          borderRadius: 5,
        }} />
      </div>
    </div>
  )
}

// ── Stat pill ─────────────────────────────────────────────────────────────────
function StatPill({ label, value, accent, surface, textPrimary, textSecond }) {
  return (
    <div style={{
      flex: 1,
      backgroundColor: surface,
      borderRadius: 20,
      padding: '36px 24px',
      textAlign: 'center',
      border: `1px solid rgba(148,168,212,0.14)`,
    }}>
      <div style={{
        fontSize: 56,
        fontWeight: 700,
        color: textPrimary,
        fontFamily: "'DM Sans', system-ui, sans-serif",
        letterSpacing: '-0.02em',
        lineHeight: 1,
        marginBottom: 12,
      }}>
        {value}
      </div>
      <div style={{
        fontSize: 22,
        fontWeight: 500,
        color: textSecond,
        fontFamily: "'DM Sans', system-ui, sans-serif",
        textTransform: 'uppercase',
        letterSpacing: '0.08em',
      }}>
        {label}
      </div>
    </div>
  )
}

// ── Section label ──────────────────────────────────────────────────────────────
function SectionLabel({ children, color }) {
  return (
    <div style={{
      fontSize: 20,
      fontWeight: 600,
      color: color,
      fontFamily: "'DM Sans', system-ui, sans-serif",
      textTransform: 'uppercase',
      letterSpacing: '0.12em',
      marginBottom: 20,
    }}>
      {children}
    </div>
  )
}

// ── DNA Card (profile-dna variant) ────────────────────────────────────────────
function DNACard({ data, deepLinkUrl, qrDataUrl, onReady }) {
  const {
    topGenres = [],
    vibe = null,
    era = null,
    totalGames = 0,
    totalHours = 0,
    reviewCount = 0,
    avgRating = null,
    username = null,
    displayName = null,
  } = data || {}

  const hasMeaningfulData = totalGames > 0 || topGenres.length > 0

  // Signal ready after one rAF
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        onReady?.()
      })
    })
    return () => cancelAnimationFrame(frame)
  }, [onReady])

  const userLabel = displayName || username || 'Your'
  const possessive = userLabel.toLowerCase().endsWith('s')
    ? `${userLabel}'`
    : `${userLabel}'s`

  return (
    <div style={{
      width: CARD_WIDTH,
      height: CARD_HEIGHT,
      backgroundColor: C.bgBase,
      position: 'relative',
      overflow: 'hidden',
      display: 'flex',
      flexDirection: 'column',
      fontFamily: "'DM Sans', system-ui, -apple-system, sans-serif",
    }}>

      {/* Subtle radial glow behind the heading */}
      <div style={{
        position: 'absolute',
        top: -200,
        left: '50%',
        transform: 'translateX(-50%)',
        width: 900,
        height: 600,
        background: `radial-gradient(ellipse at 50% 40%, rgba(59,130,246,0.18) 0%, transparent 70%)`,
        pointerEvents: 'none',
      }} />

      {/* Top strip */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '48px 72px 0',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <CheckpointMark size={44} />
          <span style={{
            fontSize: 28,
            fontWeight: 700,
            color: C.textPrimary,
            letterSpacing: '-0.01em',
          }}>
            Checkpoint
          </span>
        </div>
        <span style={{
          fontSize: 22,
          fontWeight: 500,
          color: C.textSecond,
          letterSpacing: '0.05em',
        }}>
          checkpoint.app
        </span>
      </div>

      {/* Heading */}
      <div style={{ padding: '60px 72px 0' }}>
        <div style={{
          fontSize: 34,
          fontWeight: 500,
          color: C.textSecond,
          marginBottom: 12,
          letterSpacing: '-0.01em',
        }}>
          {possessive}
        </div>
        <div style={{
          fontSize: 96,
          fontWeight: 800,
          color: C.textPrimary,
          lineHeight: 0.9,
          letterSpacing: '-0.03em',
          marginBottom: 16,
        }}>
          GAMER
        </div>
        <div style={{
          fontSize: 96,
          fontWeight: 800,
          background: `linear-gradient(90deg, ${C.accent} 0%, ${C.accentMid} 100%)`,
          WebkitBackgroundClip: 'text',
          WebkitTextFillColor: 'transparent',
          lineHeight: 0.9,
          letterSpacing: '-0.03em',
        }}>
          DNA
        </div>
      </div>

      {/* Divider */}
      <div style={{
        margin: '48px 72px 0',
        height: 1,
        backgroundColor: C.borderStr,
      }} />

      {/* Stat pills */}
      <div style={{
        display: 'flex',
        gap: 20,
        padding: '48px 72px 0',
      }}>
        <StatPill
          label="Games"
          value={hasMeaningfulData ? String(totalGames) : '—'}
          accent={C.accent}
          surface={C.bgSurface}
          textPrimary={C.textPrimary}
          textSecond={C.textSecond}
        />
        <StatPill
          label="Hours"
          value={hasMeaningfulData ? fmtHours(totalHours) : '—'}
          accent={C.accent}
          surface={C.bgSurface}
          textPrimary={C.textPrimary}
          textSecond={C.textSecond}
        />
        <StatPill
          label="Rating"
          value={starStr(avgRating)}
          accent={C.accent}
          surface={C.bgSurface}
          textPrimary={C.textPrimary}
          textSecond={C.textSecond}
        />
      </div>

      {/* Genres section */}
      {topGenres.length > 0 ? (
        <div style={{ padding: '56px 72px 0' }}>
          <SectionLabel color={C.textSecond}>Top Genres</SectionLabel>
          {topGenres.slice(0, 4).map((g) => (
            <GenreBar
              key={g.name}
              name={g.name}
              pct={g.pct}
              accent={C.accent}
              surface={C.bgSurface}
              textPrimary={C.textPrimary}
              textSecond={C.textSecond}
            />
          ))}
        </div>
      ) : (
        <div style={{ padding: '56px 72px 0' }}>
          <SectionLabel color={C.textSecond}>Top Genres</SectionLabel>
          <div style={{
            fontSize: 26,
            color: C.textTert,
            fontStyle: 'italic',
          }}>
            Add games to your library to reveal genres
          </div>
        </div>
      )}

      {/* Vibe + Era row */}
      <div style={{
        display: 'flex',
        gap: 20,
        padding: '44px 72px 0',
        flex: 1,
      }}>
        {/* Vibe */}
        <div style={{
          flex: 1,
          backgroundColor: C.bgSurface,
          borderRadius: 20,
          padding: '32px 32px',
          border: `1px solid ${C.borderSub}`,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
        }}>
          <div style={{
            fontSize: 18,
            fontWeight: 600,
            color: C.textSecond,
            textTransform: 'uppercase',
            letterSpacing: '0.10em',
            marginBottom: 16,
          }}>
            Vibe
          </div>
          <div style={{
            fontSize: vibe ? 38 : 28,
            fontWeight: 700,
            color: vibe ? C.textPrimary : C.textTert,
            letterSpacing: '-0.01em',
            lineHeight: 1.1,
            fontStyle: vibe ? 'normal' : 'italic',
          }}>
            {vibe || 'Keep playing to reveal'}
          </div>
        </div>

        {/* Era */}
        <div style={{
          flex: 1,
          backgroundColor: C.bgSurface,
          borderRadius: 20,
          padding: '32px 32px',
          border: `1px solid ${C.borderSub}`,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
        }}>
          <div style={{
            fontSize: 18,
            fontWeight: 600,
            color: C.textSecond,
            textTransform: 'uppercase',
            letterSpacing: '0.10em',
            marginBottom: 16,
          }}>
            Peak Era
          </div>
          <div style={{
            fontSize: era ? 54 : 28,
            fontWeight: 800,
            color: era ? C.accent : C.textTert,
            letterSpacing: '-0.02em',
            fontStyle: era ? 'normal' : 'italic',
          }}>
            {era ? era.label : '—'}
          </div>
        </div>
      </div>

      {/* Bottom strip — QR + deep link */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '40px 72px 56px',
      }}>
        {qrDataUrl ? (
          <div style={{
            backgroundColor: C.bgSurface,
            borderRadius: 16,
            padding: 12,
            border: `1px solid ${C.borderStr}`,
          }}>
            <img
              src={qrDataUrl}
              alt="QR code"
              width={88}
              height={88}
              style={{ display: 'block', borderRadius: 8 }}
            />
          </div>
        ) : (
          <div style={{ width: 112 }} />
        )}

        <div style={{ textAlign: 'right' }}>
          <div style={{
            fontSize: 22,
            fontWeight: 500,
            color: C.textSecond,
            marginBottom: 8,
          }}>
            Scan to view profile
          </div>
          {username && (
            <div style={{
              fontSize: 28,
              fontWeight: 700,
              color: C.textPrimary,
              letterSpacing: '-0.01em',
            }}>
              @{username}
            </div>
          )}
          <div style={{
            fontSize: 22,
            color: C.accent,
            marginTop: 6,
          }}>
            checkpoint.app
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Router — dispatch to the right variant ────────────────────────────────────

export default function BrandedShareCard({ variant, data, deepLinkUrl, qrDataUrl, onReady }) {
  if (variant === 'profile-dna') {
    return (
      <DNACard
        data={data}
        deepLinkUrl={deepLinkUrl}
        qrDataUrl={qrDataUrl}
        onReady={onReady}
      />
    )
  }

  // Unsupported variant — render a minimal placeholder so the pipeline
  // doesn't hang waiting for onReady.
  return (
    <div
      style={{
        width: CARD_WIDTH,
        height: CARD_HEIGHT,
        backgroundColor: '#0a0f1f',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <PlaceholderCard
        variant={variant}
        data={data}
        deepLinkUrl={deepLinkUrl}
        qrDataUrl={qrDataUrl}
        onReady={onReady}
      />
    </div>
  )
}

function PlaceholderCard({ variant, onReady }) {
  useEffect(() => {
    const frame = requestAnimationFrame(() => requestAnimationFrame(() => onReady?.()))
    return () => cancelAnimationFrame(frame)
  }, [onReady])

  return (
    <div style={{
      color: '#94a8d4',
      fontFamily: "'DM Sans', system-ui, sans-serif",
      fontSize: 32,
    }}>
      {variant}
    </div>
  )
}
