import React from 'react'
import { useNavigate } from 'react-router-dom'
import { LuChevronRight } from 'react-icons/lu'
import './PinnedListsSection.css'

/**
 * PinnedListsSection — Section B on the profile Home tab.
 *
 * For each pinned list (is_pinned = true, ordered by pinned_at DESC,
 * cap 5) renders a pressable row containing:
 *   - List title as a header
 *   - A tight, overlapping horizontal strip of game covers
 *
 * Tapping a row navigates to /list/:id.
 * Hidden entirely (returns null) when pinnedLists is empty.
 *
 * Props:
 *   pinnedLists  — array of list objects from getPinnedListsForUser
 *   onSeeAll     — callback for the ">" header chevron (routes to Lists tab)
 */
function PinnedListsSection({ pinnedLists, onSeeAll }) {
  const navigate = useNavigate()
  if (!pinnedLists || pinnedLists.length === 0) return null

  return (
    <section className="pinned-lists-section">
      <div className="pinned-lists-section__head">
        <h2 className="pinned-lists-section__title">Pinned</h2>
        <button
          type="button"
          className="pinned-lists-section__chevron"
          onClick={onSeeAll}
          aria-label="See all lists"
        >
          <LuChevronRight size={20} aria-hidden="true" />
        </button>
      </div>

      <div className="pinned-lists-section__rows">
        {pinnedLists.map((list) => {
          const covers = (list.previewGames || []).filter((g) => g?.image)
          return (
            <button
              key={list.id}
              type="button"
              className="pinned-list-row"
              onClick={() => navigate(`/list/${list.id}`)}
              aria-label={list.name}
            >
              <span className="pinned-list-row__name">{list.name}</span>

              {covers.length > 0 ? (
                <div className="pinned-list-row__strip" aria-hidden="true">
                  {covers.slice(0, 7).map((game, idx) => (
                    <div key={game.id || idx} className="pinned-list-row__cover">
                      <img src={game.image} alt="" loading="lazy" />
                    </div>
                  ))}
                  {list.gameCount > 7 && (
                    <div className="pinned-list-row__cover pinned-list-row__cover--overflow">
                      +{list.gameCount - 7}
                    </div>
                  )}
                </div>
              ) : (
                <p className="pinned-list-row__empty">
                  {list.gameCount > 0 ? `${list.gameCount} games` : 'Empty list'}
                </p>
              )}
            </button>
          )
        })}
      </div>
    </section>
  )
}

export default PinnedListsSection
