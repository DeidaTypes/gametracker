import React, { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useNotesWorthReading } from '../../hooks/useExploreData'
import { COVER_FALLBACK } from '../../utils/coverFallback'
import './NotesWorthReading.css'

// A note only "qualifies" when it carries enough real prose to make a
// meaningful pull-quote. Shorter blurbs (or rating-only reviews) are skipped.
const MIN_BODY_LENGTH = 40
const MAX_EXCERPT_LENGTH = 150
const MAX_NOTES = 3

/** Collapse whitespace and trim a review body to a punchy quote. */
function toExcerpt(body) {
  const clean = String(body || '').replace(/\s+/g, ' ').trim()
  if (clean.length <= MAX_EXCERPT_LENGTH) return clean
  const cut = clean.slice(0, MAX_EXCERPT_LENGTH)
  const lastSpace = cut.lastIndexOf(' ')
  return `${(lastSpace > 60 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`
}

function reviewerName(row) {
  return (
    row.users?.display_name?.trim() ||
    row.users?.username?.trim() ||
    'Anonymous'
  )
}

/**
 * NotesWorthReading — Discover "Notes worth reading" shelf.
 *
 * Renders 2–3 REAL community reviews as pull-quote cards: cover thumbnail +
 * punchy excerpt + game + reviewer + rating. Only reviews with substantive
 * body text qualify. Renders nothing (no header, no placeholder) when the
 * community has none that qualify.
 */
export default function NotesWorthReading() {
  const navigate = useNavigate()
  const { data, loading } = useNotesWorthReading()

  const notes = useMemo(() => {
    if (!Array.isArray(data)) return []
    return data
      .filter((r) => {
        const body = String(r.body || '').trim()
        return body.length >= MIN_BODY_LENGTH && Number(r.rating) > 0 && r.game_title
      })
      .slice(0, MAX_NOTES)
  }, [data])

  // Hide entirely while loading and when nothing qualifies — no layout jank,
  // no empty placeholder.
  if (loading || notes.length === 0) return null

  return (
    <section className="explore-section notes-section">
      <div className="explore-section__pad">
        <h2 className="discover-section-title">Notes worth reading</h2>
      </div>

      <div className="notes-list">
        {notes.map((note) => (
          <button
            key={note.id}
            type="button"
            className="note-card"
            onClick={() => navigate(`/review/${note.id}`)}
            aria-label={`Read ${reviewerName(note)}'s review of ${note.game_title}`}
          >
            <div className="note-card__cover">
              <img
                src={note.game_image || COVER_FALLBACK}
                alt=""
                loading="lazy"
                onError={(e) => { e.currentTarget.src = COVER_FALLBACK }}
              />
            </div>

            <div className="note-card__body">
              <p className="note-card__quote">
                <span className="note-card__quote-mark" aria-hidden="true">“</span>
                {toExcerpt(note.body)}
                <span className="note-card__quote-mark" aria-hidden="true">”</span>
              </p>
              <p className="note-card__meta">
                <span className="note-card__rating" aria-label={`Rated ${Number(note.rating).toFixed(1)} out of 5`}>
                  ★ {Number(note.rating).toFixed(1)}
                </span>
                <span className="note-card__dot" aria-hidden="true">·</span>
                <span className="note-card__game">{note.game_title}</span>
                <span className="note-card__dot" aria-hidden="true">·</span>
                <span className="note-card__author">{reviewerName(note)}</span>
              </p>
            </div>
          </button>
        ))}
      </div>
    </section>
  )
}
