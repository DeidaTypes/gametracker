import React from 'react'
import { useNavigate } from 'react-router-dom'
import { LuChevronRight } from 'react-icons/lu'
import ListCoverCluster from './ListCoverCluster'
import './PinnedListsSection.css'

/**
 * PinnedListsSection — Section B on the profile Home tab.
 *
 * For each pinned list (is_pinned = true, ordered by pinned_at DESC,
 * cap 5) renders a pressable row containing:
 *   - A ListCoverCluster cover cluster
 *   - List title + game count
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
        {pinnedLists.map((list) => (
          <button
            key={list.id}
            type="button"
            className="pinned-list-row"
            onClick={() => navigate(`/list/${list.id}`)}
            aria-label={list.name}
          >
            <ListCoverCluster
              games={list.previewGames}
              coverImageUrl={list.coverImageUrl}
              name={list.name}
              size="lg"
            />
            <span className="pinned-list-row__body">
              <span className="pinned-list-row__name">{list.name}</span>
              <span className="pinned-list-row__meta">
                {list.gameCount > 0 ? `${list.gameCount} ${list.gameCount === 1 ? 'game' : 'games'}` : 'Empty list'}
              </span>
            </span>
          </button>
        ))}
      </div>
    </section>
  )
}

export default PinnedListsSection
