import React from 'react'
import { Sparkles } from 'lucide-react'
import DiscoverSubHeader from '../components/explore/DiscoverSubHeader'
import CleanGameTile from '../components/explore/CleanGameTile'
import EmptyState from '../components/EmptyState'
import { useActiveThemedDrop } from '../hooks/useExploreData'
import { nextDropLabel } from '../utils/dropSchedule'
import './ThemedDropDetail.css'

function SkeletonTile() {
  return <div className="tdd-sk-cover skeleton" aria-hidden="true" />
}

/**
 * ThemedDropDetail — the full drop behind the Discover card.
 * Route: /discover/drop
 *
 * Every game in the live drop as a poster grid: cover, title, nothing
 * else. Same clean-cover rule as the rest of Explore, so a score never
 * pre-judges a theme pick — tap through for that.
 *
 * Reachable only while a drop is live (the card that links here is
 * absent otherwise), but a bookmark or a drop expiring mid-session can
 * still land here, so an ended drop says so plainly.
 */
export default function ThemedDropDetail() {
  const { data: drop, loading } = useActiveThemedDrop()

  const games = drop?.games || []
  const isLive = Boolean(drop?.active && drop.theme && games.length > 0)
  const nextDrop = nextDropLabel(drop?.expiresAt)

  return (
    <div className="tdd-page">
      <DiscoverSubHeader title={isLive ? drop.theme.displayName : 'This week\u2019s drop'} />

      <div className="tdd-content">
        {loading ? (
          <div className="clean-tile-grid">
            {Array.from({ length: 9 }, (_, i) => <SkeletonTile key={i} />)}
          </div>
        ) : !isLive ? (
          <EmptyState icon={Sparkles} body="This drop has ended — a new one lands soon." />
        ) : (
          <>
            <div className="tdd-intro">
              {drop.theme.subtitle && (
                <p className="tdd-subtitle">{drop.theme.subtitle}</p>
              )}
              {nextDrop && <span className="tdd-next">{nextDrop}</span>}
            </div>

            <div className="clean-tile-grid">
              {games.map((game) => (
                <CleanGameTile key={game.id} game={game} />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
