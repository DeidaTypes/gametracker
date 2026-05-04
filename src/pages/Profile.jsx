import React, { useState, useEffect, useMemo } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { getReviewsForUser } from '../services/reviewService'
import { useAuth } from '../contexts/AuthContext'
import {
  getGamesFromList,
} from '../services/libraryService'
import { getListsForUser } from '../services/listService'
import { getProfile, initializeProfile, generateDefaultAvatar } from '../services/profileService'
import {
  getProfileStats,
  getTopFavoriteGames,
  getRecentlyPlayedGames,
} from '../services/profileStatsService'
import EditProfileModal from '../components/EditProfileModal'
import GameCard from '../components/GameCard'
import SharedCover, { SharedCoverScope, findDuplicateGameIds } from '../components/SharedCover'
import StarRating from '../components/StarRating'
import ActivityFeed from '../components/ActivityFeed'
import EmptyState from '../components/EmptyState'
import SecondaryButton from '../components/forms/SecondaryButton'
import StatRowSkeleton from '../components/skeletons/StatRowSkeleton'
import { GameCardSkeletonRow } from '../components/skeletons/GameCardSkeleton'
import { HiPencil } from 'react-icons/hi'
import { getBestImageUrl } from '../services/imageUtils'
import './Profile.css'

function getGenreColor(genre) {
  if (!genre) return '#3F4A5A'
  const s = genre.toLowerCase()
  if (s.includes('role-playing') || s.includes('rpg')) return '#5B4B7A'
  if (s.includes('adventure')) return '#3F5F4F'
  if (s.includes('strategy') || s.includes('tactical')) return '#3F5366'
  if (s.includes('action')) return '#6B4A3E'
  if (s.includes('shoot')) return '#4A4A5A'
  if (s.includes('sport')) return '#3A5F3F'
  if (s.includes('racing') || s.includes('drive')) return '#4A4028'
  if (s.includes('fight')) return '#5C3A3A'
  if (s.includes('puzzle') || s.includes('logic')) return '#3A4A5C'
  if (s.includes('simulat')) return '#3F5060'
  if (s.includes('horror') || s.includes('survival')) return '#2D2D3A'
  if (s.includes('platform')) return '#3A4A3A'
  if (s.includes('indie')) return '#4A3A5A'
  return '#3F4A5A'
}

function getPlatformColor(platform) {
  if (!platform) return '#4A5568'
  const s = platform.toLowerCase()
  if (s.includes('playstation') || s.includes('ps4') || s.includes('ps5') || s.includes('ps3')) return '#003791'
  if (s.includes('xbox')) return '#107C10'
  if (s.includes('nintendo') || s.includes('switch') || s.includes('wii') || s.includes('3ds')) return '#C0001E'
  if (s.includes('pc') || s.includes('windows') || s.includes('steam') || s.includes('linux') || s.includes('mac')) return '#4A5568'
  if (s.includes('ios') || s.includes('iphone') || s.includes('ipad')) return '#555560'
  if (s.includes('android')) return '#3A6644'
  if (s.includes('stadia')) return '#4A2D6E'
  return '#4A5568'
}

function Profile() {
  const navigate = useNavigate()
  const { userId } = useParams()
  const { user } = useAuth()
  const isOwnProfile = !userId
  // Profile page currently only renders the signed-in user's data — there's
  // no /profile/:userId UX yet — but we still pass the looked-up id so the
  // review query is correct once it's wired up.
  const targetUserId = userId || user?.id

  const [profile, setProfile] = useState(null)
  const [reviewCount, setReviewCount] = useState(0)
  const [allReviews, setAllReviews] = useState([])
  const [showEditModal, setShowEditModal] = useState(false)
  const [bioExpanded, setBioExpanded] = useState(false)
  const [activeTab, setActiveTab] = useState('reviews')

  const [stats, setStats] = useState(null)
  const [topGames, setTopGames] = useState([])
  const [recentlyPlayed, setRecentlyPlayed] = useState([])

  const [wantToPlayGames, setWantToPlayGames] = useState([])
  const [currentlyPlayingGames, setCurrentlyPlayingGames] = useState([])
  const [playedGames, setPlayedGames] = useState([])
  const [customLists, setCustomLists] = useState([])

  useEffect(() => {
    loadProfileData()

    const handleStorageChange = () => loadProfileData()

    window.addEventListener('storage', handleStorageChange)
    window.addEventListener('reviewAdded', handleStorageChange)
    window.addEventListener('profileUpdated', handleStorageChange)
    window.addEventListener('libraryUpdated', handleStorageChange)
    window.addEventListener('activityUpdated', handleStorageChange)

    return () => {
      window.removeEventListener('storage', handleStorageChange)
      window.removeEventListener('reviewAdded', handleStorageChange)
      window.removeEventListener('profileUpdated', handleStorageChange)
      window.removeEventListener('libraryUpdated', handleStorageChange)
      window.removeEventListener('activityUpdated', handleStorageChange)
    }
  }, [userId, targetUserId])

  const loadProfileData = async () => {
    const userProfile = getProfile() || initializeProfile()
    setProfile(userProfile)

    // Reviews now live in Supabase. Fetch the current viewer's reviews
    // and feed both the count badge and the Reviews tab list from the
    // same fetch (already DESC by created_at server-side).
    if (targetUserId) {
      try {
        const rows = await getReviewsForUser(targetUserId)
        setReviewCount(rows.length)
        setAllReviews(rows)
      } catch (err) {
        console.error('[profile] failed to load reviews:', err)
        setAllReviews([])
        setReviewCount(0)
      }
    } else {
      setAllReviews([])
      setReviewCount(0)
    }

    setStats(getProfileStats())
    setTopGames(getTopFavoriteGames(5))
    setRecentlyPlayed(getRecentlyPlayedGames(6))

    setWantToPlayGames(getGamesFromList('want-to-play'))
    setCurrentlyPlayingGames(getGamesFromList('currently-playing'))
    setPlayedGames(getGamesFromList('played'))

    if (targetUserId) {
      try {
        const lists = await getListsForUser(targetUserId)
        setCustomLists(
          lists.map((l) => ({
            id: l.id,
            name: l.name,
            description: l.description || '',
            createdAt: l.createdAt,
            gameCount: l.gameCount,
            previewGames: l.previewGames || [],
          }))
        )
      } catch (err) {
        console.error('[profile] failed to load custom lists:', err)
        setCustomLists([])
      }
    } else {
      setCustomLists([])
    }
  }

  const handleProfileUpdate = (updatedProfile) => {
    setProfile(updatedProfile)
    window.dispatchEvent(new Event('profileUpdated'))
  }

  const handleAvatarClick = () => {
    if (isOwnProfile) setShowEditModal(true)
  }

  const handleGameClick = (gameId, coverImage) =>
    navigate(`/game/${gameId}`, coverImage ? { state: { coverImage } } : undefined)

  // Same game can appear in multiple sections (e.g. Recently Played +
  // Currently Playing tab + a custom list preview, OR multiple reviews
  // of the same game in the Reviews tab). Drop the layoutId for any
  // cover that's also rendered elsewhere on this page so Motion never
  // tries to fly the same id from two source positions at once.
  const duplicateIds = useMemo(() => {
    // Reviews can repeat a gameId (one user, many reviews). Map them
    // into the same shape findDuplicateGameIds expects ({ id }).
    // Supabase rows expose `igdb_game_id` / `game_image`.
    const reviewGames = allReviews
      .filter((r) => r?.igdb_game_id)
      .map((r) => ({ id: r.igdb_game_id, image: r.game_image }))
    return findDuplicateGameIds(
      recentlyPlayed,
      topGames,
      wantToPlayGames.slice(0, 12),
      currentlyPlayingGames.slice(0, 12),
      playedGames.slice(0, 12),
      reviewGames,
      ...customLists.map((l) => l.previewGames || [])
    )
  }, [
    allReviews,
    recentlyPlayed,
    topGames,
    wantToPlayGames,
    currentlyPlayingGames,
    playedGames,
    customLists,
  ])

  if (!profile) {
    return (
      <div className="profile-page" aria-hidden="true">
        {/* Header skeleton */}
        <div className="profile-header-section">
          <div className="skeleton profile-sk-avatar" />
          <div className="profile-sk-info">
            <div className="skeleton profile-sk-name" />
            <div className="skeleton profile-sk-bio-1" />
            <div className="skeleton profile-sk-bio-2" />
          </div>
        </div>
        {/* Stat row skeleton */}
        <StatRowSkeleton />
        {/* Game card row skeletons */}
        <div className="profile-sk-section">
          <div className="skeleton profile-sk-section-label" />
          <GameCardSkeletonRow count={5} />
        </div>
        <div className="profile-sk-section">
          <div className="skeleton profile-sk-section-label" />
          <GameCardSkeletonRow count={5} />
        </div>
      </div>
    )
  }

  const defaultAvatar = generateDefaultAvatar(profile.displayName || 'User')
  const avatarDisplay = profile.avatar?.type === 'data' ? profile.avatar.data : null

  const bioMaxLength = 120
  const shouldTruncateBio = profile.bio && profile.bio.length > bioMaxLength
  const displayBio =
    shouldTruncateBio && !bioExpanded ? profile.bio.substring(0, bioMaxLength) + '...' : profile.bio

  return (
    <SharedCoverScope duplicateIds={duplicateIds}>
    <div className="profile-page">
      {/* ── Header ── */}
      <div className="profile-header-section">
        <div className="profile-avatar-container">
          <div
            className={`profile-avatar ${isOwnProfile ? 'editable' : ''}`}
            onClick={handleAvatarClick}
          >
            {avatarDisplay ? (
              <img
                src={avatarDisplay}
                alt={profile.displayName}
                className="profile-avatar-image"
              />
            ) : (
              <div
                className="profile-avatar-generated"
                style={{ backgroundColor: defaultAvatar.color }}
              >
                {defaultAvatar.initials}
              </div>
            )}
            {isOwnProfile && (
              <div className="avatar-edit-overlay">
                <HiPencil className="avatar-edit-icon" />
              </div>
            )}
          </div>
        </div>

        <div className="profile-info">
          <div className="profile-name-row">
            <h2 className="profile-display-name">{profile.displayName}</h2>
            {profile.username?.trim() && <span className="profile-username">@{profile.username}</span>}
          </div>

          {profile.bio ? (
            <div className="profile-bio">
              <p>{displayBio}</p>
              {shouldTruncateBio && (
                <button className="bio-expand-button" onClick={() => setBioExpanded(!bioExpanded)}>
                  {bioExpanded ? 'Less' : 'More'}
                </button>
              )}
            </div>
          ) : isOwnProfile ? (
            <div className="profile-bio">
              <button className="bio-placeholder-link" onClick={() => setShowEditModal(true)}>
                Tell people what you play →
              </button>
            </div>
          ) : null}

          {(stats?.favoriteGenre || stats?.favoritePlatform) && (
            <div className="profile-identity-tags">
              {stats.favoriteGenre && (
                <span
                  className="identity-tag"
                  style={{ backgroundColor: `${getGenreColor(stats.favoriteGenre)}40` }}
                >
                  {stats.favoriteGenre}
                </span>
              )}
              {stats.favoritePlatform && (
                <span
                  className="identity-tag"
                  style={{ backgroundColor: `${getPlatformColor(stats.favoritePlatform)}40` }}
                >
                  {stats.favoritePlatform}
                </span>
              )}
            </div>
          )}
        </div>

        <div className="profile-header-actions">
          {isOwnProfile ? (
            <SecondaryButton
              onClick={() => setShowEditModal(true)}
              aria-label="Edit profile"
              className="profile-edit-btn"
            >
              <HiPencil aria-hidden="true" />
              Edit profile
            </SecondaryButton>
          ) : (
            <button className="follow-button">Follow</button>
          )}
        </div>
      </div>

      {/* ── Stats Bar ──
           Each tile drills into the full Stats screen (/stats). The
           granular destinations (Library, Reviews tab) are still
           reachable from the bottom nav and the tabs below; making
           every tile a Stats entry point matches Sprint 2 P18 and
           lets "View full stats" act as the single source of truth
           for the year-in-games view. */}
      {stats && (
        <>
          <div className="profile-stats-bar">
            <button
              className="profile-stat"
              onClick={() => navigate('/stats')}
              aria-label={`${stats.totalGames} games – view full stats`}
            >
              <span className="profile-stat-value">{stats.totalGames}</span>
              <span className="profile-stat-label">Games</span>
            </button>
            <button
              className="profile-stat"
              onClick={() => navigate('/stats')}
              aria-label={`${stats.totalHours} hours played – view full stats`}
            >
              <span className="profile-stat-value">{stats.totalHours}</span>
              <span className="profile-stat-label">Hours</span>
            </button>
            <button
              className="profile-stat"
              onClick={() => navigate('/stats')}
              aria-label={`${stats.reviewCount} reviews – view full stats`}
            >
              <span className="profile-stat-value">{stats.reviewCount}</span>
              <span className="profile-stat-label">Reviews</span>
            </button>
          </div>
          <div className="profile-stats-cta-row">
            <button
              type="button"
              className="profile-stats-cta"
              onClick={() => navigate('/stats')}
            >
              View full stats →
            </button>
          </div>
        </>
      )}

      {/* ── Tab Navigation ── */}
      <div className="profile-tabs">
        <button
          className={`profile-tab ${activeTab === 'reviews' ? 'active' : ''}`}
          onClick={() => setActiveTab('reviews')}
        >
          Reviews ({reviewCount})
        </button>
        <button
          className={`profile-tab ${activeTab === 'lists' ? 'active' : ''}`}
          onClick={() => setActiveTab('lists')}
        >
          Lists
        </button>
        <button
          className={`profile-tab ${activeTab === 'activity' ? 'active' : ''}`}
          onClick={() => setActiveTab('activity')}
        >
          Activity
        </button>
      </div>

      {/* ── Tab Content ── */}
      <div className="profile-tab-content">
        {activeTab === 'reviews' && (
          <div className="tab-pane">
            {allReviews.length > 0 ? (
              <div className="reviews-list">
                {allReviews.map((review) => {
                  const gameId = review.igdb_game_id
                  const gameTitle = review.game_title || 'Untitled Game'
                  const gameImage = review.game_image
                  const hours = Number(review.hours_played) || 0
                  const dateLabel = review.created_at
                    ? new Date(review.created_at).toLocaleDateString()
                    : ''
                  return (
                    <div
                      key={review.id}
                      className="review-item"
                      onClick={() =>
                        navigate(
                          `/game/${gameId}?review=${encodeURIComponent(review.id)}`,
                          gameImage ? { state: { coverImage: gameImage } } : undefined
                        )
                      }
                    >
                      {gameImage && (
                        <div className="review-item-image-wrapper">
                          <SharedCover gameId={gameId} imageSrc={gameImage}>
                            <img
                              src={gameImage}
                              alt={gameTitle}
                              className="review-item-image"
                            />
                          </SharedCover>
                        </div>
                      )}
                      <div className="review-item-content">
                        <h3>{gameTitle}</h3>
                        <div className="review-item-rating">
                          <StarRating rating={parseFloat(review.rating)} size={18} />
                        </div>
                        {/* Spec: don't blur the user's OWN reviews on their
                            own Profile, even if has_spoilers is true. */}
                        <p className="review-item-text">{review.body}</p>
                        <span className="review-item-date">
                          {dateLabel}
                          {hours > 0 && ` \u2022 ${hours}h played`}
                        </span>
                      </div>
                    </div>
                  )
                })}
              </div>
            ) : (
              <EmptyState
                variant="reviews"
                copy="No reviews written yet — play something and share your thoughts"
                cta="Browse games"
                onCta={() => navigate('/search')}
              />
            )}
          </div>
        )}

        {activeTab === 'lists' && (
          <div className="tab-pane">
            <div className="lists-container">
              {isOwnProfile && (
                <div className="list-section">
                  <h3 className="list-section-title">Custom Lists</h3>
                  {customLists.length === 0 && (
                    <EmptyState
                      compact
                      variant="lists"
                      copy="No custom lists yet — head to Library to create one"
                      cta="Go to Library"
                      onCta={() => navigate('/library')}
                    />
                  )}
                  <div className="profile-custom-lists">
                    {customLists.map((list) => (
                      <button
                        key={list.id}
                        type="button"
                        className="profile-custom-list-card"
                        onClick={() => navigate(`/list/${list.id}`)}
                      >
                        <div className="profile-custom-list-info">
                          <h4 className="profile-custom-list-name">
                            {list.name}
                          </h4>
                          {list.description && (
                            <p className="profile-custom-list-description">
                              {list.description}
                            </p>
                          )}
                          <p className="profile-custom-list-count">
                            {list.gameCount}{' '}
                            {list.gameCount === 1 ? 'game' : 'games'}
                          </p>
                        </div>
                        <div className="profile-custom-list-preview">
                          {list.previewGames.length > 0 ? (
                            list.previewGames.map((g) => (
                              <div
                                key={g.id}
                                className="profile-custom-list-cover"
                              >
                                {g.image ? (
                                  <SharedCover gameId={g.id} imageSrc={g.image}>
                                    <img
                                      src={g.image}
                                      alt={g.title}
                                      loading="lazy"
                                    />
                                  </SharedCover>
                                ) : (
                                  <span>{g.title?.charAt(0) || '?'}</span>
                                )}
                              </div>
                            ))
                          ) : (
                            <span className="profile-custom-list-empty">
                              Empty
                            </span>
                          )}
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className="list-section">
                <h3 className="list-section-title">Want to Play</h3>
                {wantToPlayGames.length > 0 ? (
                  <div className="games-grid">
                    {wantToPlayGames.slice(0, 12).map((game) => (
                      <GameCard key={game.id} game={game} />
                    ))}
                  </div>
                ) : (
                  <EmptyState
                    compact
                    variant="want-to-play"
                    copy="Your backlog is empty — discover games to add"
                    cta="Browse games"
                    onCta={() => navigate('/search')}
                  />
                )}
              </div>

              <div className="list-section">
                <h3 className="list-section-title">Currently Playing</h3>
                {currentlyPlayingGames.length > 0 ? (
                  <div className="games-grid">
                    {currentlyPlayingGames.slice(0, 12).map((game) => (
                      <GameCard key={game.id} game={game} />
                    ))}
                  </div>
                ) : (
                  <EmptyState
                    compact
                    variant="currently-playing"
                    copy="Not playing anything right now — start something new"
                    cta="Browse games"
                    onCta={() => navigate('/search')}
                  />
                )}
              </div>

              <div className="list-section">
                <h3 className="list-section-title">Played</h3>
                {playedGames.length > 0 ? (
                  <div className="games-grid">
                    {playedGames.slice(0, 12).map((game) => (
                      <GameCard key={game.id} game={game} />
                    ))}
                  </div>
                ) : (
                  <EmptyState
                    compact
                    variant="played"
                    copy="No finished games yet — mark one complete to see it here"
                    cta="Browse games"
                    onCta={() => navigate('/search')}
                  />
                )}
              </div>
            </div>
          </div>
        )}

        {activeTab === 'activity' && (
          <div className="tab-pane">
            <div className="activity-tab-content">
              {topGames.length > 0 && (
                <section className="activity-subsection">
                  <h3 className="activity-subsection-title">Top Rated</h3>
                  <div className="top-games-row">
                    {topGames.map((game, i) => (
                      <div
                        key={game.id}
                        className="top-game-card"
                        onClick={() => handleGameClick(game.id, game.image)}
                      >
                        <span className="top-game-rank">#{i + 1}</span>
                        <div className="top-game-cover">
                          <SharedCover gameId={game.id} imageSrc={game.image}>
                            <img
                              src={game.image}
                              alt={game.title}
                              onError={(e) => {
                                e.target.src = `https://via.placeholder.com/80x110/152035/C8965A?text=${encodeURIComponent(game.title?.charAt(0) || '?')}`
                              }}
                            />
                          </SharedCover>
                        </div>
                        <div className="top-game-info">
                          <span className="top-game-title">{game.title}</span>
                          <StarRating rating={game.rating} size={14} />
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {recentlyPlayed.length > 0 && (
                <section className="activity-subsection">
                  <h3 className="activity-subsection-title">Recently Played</h3>
                  <div className="recently-played-row">
                    {recentlyPlayed.map((game) => {
                      const imgUrl = getBestImageUrl(game, 300) || game.image
                      return (
                        <div
                          key={game.id}
                          className="recent-game-card"
                          onClick={() => handleGameClick(game.id, imgUrl)}
                        >
                          <div className="recent-game-cover">
                            <SharedCover gameId={game.id} imageSrc={imgUrl}>
                              <img
                                src={imgUrl}
                                alt={game.title}
                                loading="lazy"
                                onError={(e) => {
                                  e.target.src = `https://via.placeholder.com/120x160/152035/C8965A?text=${encodeURIComponent(game.title?.charAt(0) || '?')}`
                                }}
                              />
                            </SharedCover>
                            {game.progressPercent != null && game.progressPercent > 0 && (
                              <div className="recent-game-progress">
                                <div
                                  className="recent-game-progress-fill"
                                  style={{ width: `${Math.min(game.progressPercent, 100)}%` }}
                                />
                              </div>
                            )}
                          </div>
                          <p className="recent-game-title">{game.title}</p>
                          {game.hoursPlayed > 0 && (
                            <p className="recent-game-hours">{game.hoursPlayed}h</p>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </section>
              )}

              <section className="activity-subsection">
                <h3 className="activity-subsection-title">Activity Feed</h3>
                <ActivityFeed
                  userId={targetUserId}
                  avatarData={avatarDisplay}
                  displayName={profile.displayName || 'You'}
                  avatarColor={defaultAvatar.color}
                />
              </section>
            </div>
          </div>
        )}
      </div>

      <EditProfileModal
        isOpen={showEditModal}
        onClose={() => setShowEditModal(false)}
        profile={profile}
        onUpdate={handleProfileUpdate}
      />
    </div>
    </SharedCoverScope>
  )
}

export default Profile
