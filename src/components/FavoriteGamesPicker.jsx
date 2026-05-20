import React, { useEffect, useMemo, useState } from 'react'
import { LuCheck } from 'react-icons/lu'
import { getGamesFromList } from '../services/libraryService'
import { showToast } from './Toast'
import { SubmitButton, SecondaryButton } from './forms'
import './FavoriteGamesPicker.css'

const MAX_FAVORITES = 4

/**
 * Modal that lets the user pick up to MAX_FAVORITES games from their
 * library to feature on their Profile Home tab.
 *
 * The library used as the source set is the union of every tracker list
 * (Want / Playing / Played / Dropped) — that's what "your library" means
 * elsewhere in the app and matches what the user expects when looking
 * for "the games I've engaged with".
 *
 * Persistence is handled by the parent (EditProfileModal) — this picker
 * only owns the in-modal selection state and reports back via
 * `onSave(selectedGames)` when the user taps Save.
 */
function FavoriteGamesPicker({ isOpen, initialSelected = [], onSave, onClose }) {
  const [selected, setSelected] = useState(initialSelected)

  useEffect(() => {
    if (isOpen) setSelected(initialSelected)
  }, [isOpen, initialSelected])

  // Snapshot the library on open. The trackers live in localStorage so
  // there's nothing to await — but freezing once at open-time means the
  // grid doesn't reshuffle if the user backgrounds + foregrounds while
  // the picker is up.
  const libraryGames = useMemo(() => {
    if (!isOpen) return []
    const all = [
      ...getGamesFromList('currently-playing'),
      ...getGamesFromList('played'),
      ...getGamesFromList('want-to-play'),
      ...getGamesFromList('dropped'),
    ]
    const seen = new Set()
    const uniq = []
    for (const g of all) {
      const key = String(g.id)
      if (seen.has(key)) continue
      seen.add(key)
      uniq.push(g)
    }
    return uniq
  }, [isOpen])

  if (!isOpen) return null

  const isPicked = (id) => selected.some((g) => String(g.id) === String(id))

  const togglePick = (game) => {
    if (isPicked(game.id)) {
      setSelected((prev) => prev.filter((g) => String(g.id) !== String(game.id)))
      return
    }
    if (selected.length >= MAX_FAVORITES) {
      showToast(`You can pick up to ${MAX_FAVORITES} favorites`, 'error', 1800)
      return
    }
    // Slim shape — only the fields Profile.jsx and the Edit Profile
    // preview actually render. Anything else from the library row is
    // discarded so we don't bloat the localStorage profile blob.
    setSelected((prev) => [
      ...prev,
      {
        id: game.id,
        title: game.title || '',
        image: game.image || null,
        developer:
          (Array.isArray(game.developers) && game.developers[0]) ||
          game.developer ||
          '',
      },
    ])
  }

  const handleSave = () => {
    onSave(selected)
    onClose()
  }

  return (
    <div className="modal-overlay fav-picker-overlay" onClick={onClose}>
      <div
        className="modal-content fav-picker-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <div className="modal-header__text">
            <span className="modal-eyebrow">Profile</span>
            <h2 className="modal-title">Pick favorite games</h2>
          </div>
          <button
            type="button"
            className="modal-close-button"
            onClick={onClose}
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <div className="modal-body fav-picker-body">
          <p className="fav-picker-help">
            Choose up to {MAX_FAVORITES} games from your library.{' '}
            <span className="fav-picker-help__count">
              {selected.length} / {MAX_FAVORITES} selected
            </span>
          </p>

          {libraryGames.length === 0 ? (
            <div className="fav-picker-empty">
              <p>Your library is empty.</p>
              <p className="fav-picker-empty__sub">
                Add games to any tracker (Want / Playing / Played) and
                they&rsquo;ll show up here.
              </p>
            </div>
          ) : (
            <ul className="fav-picker-grid" role="listbox" aria-multiselectable="true">
              {libraryGames.map((game) => {
                const picked = isPicked(game.id)
                return (
                  <li key={game.id} className="fav-picker-cell">
                    <button
                      type="button"
                      role="option"
                      aria-selected={picked}
                      className={`fav-picker-tile${picked ? ' fav-picker-tile--picked' : ''}`}
                      onClick={() => togglePick(game)}
                    >
                      <div className="fav-picker-cover">
                        {game.image ? (
                          <img src={game.image} alt="" loading="lazy" />
                        ) : (
                          <span className="fav-picker-cover__fallback">
                            {game.title?.charAt(0) || '?'}
                          </span>
                        )}
                        {picked && (
                          <span className="fav-picker-check" aria-hidden="true">
                            <LuCheck size={16} />
                          </span>
                        )}
                      </div>
                      <span className="fav-picker-title">{game.title}</span>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>

        <div className="modal-footer">
          <SubmitButton type="button" onClick={handleSave}>
            Save favorites
          </SubmitButton>
          <SecondaryButton onClick={onClose}>Cancel</SecondaryButton>
        </div>
      </div>
    </div>
  )
}

export default FavoriteGamesPicker
