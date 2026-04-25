import React, { useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { getAllReviews, getReviewCount } from '../services/reviewService'
import { getGamesFromList } from '../services/libraryService'
import { getProfile, initializeProfile, generateDefaultAvatar } from '../services/profileService'
import {
  getProfileStats,
  getTopFavoriteGames,
  getRecentlyPlayedGames,
} from '../services/profileStatsService'
import EditProfileModal from '../components/EditProfileModal'
import GameCard from '../components/GameCard'
import StarRating from '../components/StarRating'
import ActivityFeed from '../components/ActivityFeed'
import { HiPencil } from 'react-icons/hi'
import { getBestImageUrl } from '../services/imageUtils'
import './Profile.css'

function Profile() {
  const navigate = useNavigate()
  const { userId } = useParams()
  const isOwnProfile = !userId

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
  }, [userId])

  const loadProfileData = () => {
    const userProfile = getProfile() || initializeProfile()
    setProfile(userProfile)

    const count = getReviewCount()
    setReviewCount(count)

    const reviews = getAllReviews()
    setAllReviews(reviews.sort((a, b) => new Date(b.date) - new Date(a.date)))

    setStats(getProfileStats())
    setTopGames(getTopFavoriteGames(5))
    setRecentlyPlayed(getRecentlyPlayedGames(6))

    setWantToPlayGames(getGamesFromList('want-to-play'))
    setCurrentlyPlayingGames(getGamesFromList('currently-playing'))
    setPlayedGames(getGamesFromList('played'))
  }

  const handleProfileUpdate = (updatedProfile) => {
    setProfile(updatedProfile)
    window.dispatchEvent(new Event('profileUpdated'))
  }

  const handleAvatarClick = () => {
    if (isOwnProfile) setShowEditModal(true)
  }

  const handleGameClick = (gameId) => navigate(`/game/${gameId}`)

  if (!profile) {
    return (
      <div className="profile-page">
        <div className="loading-container">
          <div className="loading-spinner"></div>
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
            {profile.username && <span className="profile-username">@{profile.username}</span>}
          </div>

          {profile.bio && (
            <div className="profile-bio">
              <p>{displayBio}</p>
              {shouldTruncateBio && (
                <button className="bio-expand-button" onClick={() => setBioExpanded(!bioExpanded)}>
                  {bioExpanded ? 'Less' : 'More'}
                </button>
              )}
            </div>
          )}

          {stats?.favoriteGenre && (
            <div className="profile-identity-tags">
              {stats.favoriteGenre && (
                <span className="identity-tag genre-tag">{stats.favoriteGenre}</span>
              )}
              {stats.favoritePlatform && (
                <span className="identity-tag platform-tag">{stats.favoritePlatform}</span>
              )}
            </div>
          )}

          <div className="profile-actions">
            {isOwnProfile ? (
              <button className="edit-profile-button" onClick={() => setShowEditModal(true)}>
                <HiPencil />
                Edit Profile
              </button>
            ) : (
              <button className="follow-button">Follow</button>
            )}
          </div>
        </div>
      </div>

      {/* ── Stats Bar ── */}
      {stats && (
        <div className="profile-stats-bar">
          <div className="profile-stat">
            <span className="profile-stat-value">{stats.totalGames}</span>
            <span className="profile-stat-label">Games</span>
          </div>
          <div className="profile-stat">
            <span className="profile-stat-value">{stats.totalHours}</span>
            <span className="profile-stat-label">Hours</span>
          </div>
          <div className="profile-stat">
            <span className="profile-stat-value">
              {stats.avgRating > 0 ? stats.avgRating.toFixed(1) : '--'}
            </span>
            <span className="profile-stat-label">Avg Rating</span>
          </div>
          <div className="profile-stat">
            <span className="profile-stat-value">{stats.reviewCount}</span>
            <span className="profile-stat-label">Reviews</span>
          </div>
        </div>
      )}

      {/* ── Top 5 Favorites ── */}
      {topGames.length > 0 && (
        <div className="profile-section">
          <h3 className="profile-section-title">Top Rated</h3>
          <div className="top-games-row">
            {topGames.map((game, i) => (
              <div
                key={game.id}
                className="top-game-card"
                onClick={() => handleGameClick(game.id)}
              >
                <span className="top-game-rank">#{i + 1}</span>
                <div className="top-game-cover">
                  <img
                    src={game.image}
                    alt={game.title}
                    onError={(e) => {
                      e.target.src = `https://via.placeholder.com/80x110/152035/C8965A?text=${encodeURIComponent(game.title?.charAt(0) || '?')}`
                    }}
                  />
                </div>
                <div className="top-game-info">
                  <span className="top-game-title">{game.title}</span>
                  <StarRating rating={game.rating} size={14} />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Recently Played ── */}
      {recentlyPlayed.length > 0 && (
        <div className="profile-section">
          <h3 className="profile-section-title">Recently Played</h3>
          <div className="recently-played-row">
            {recentlyPlayed.map((game) => {
              const imgUrl = getBestImageUrl(game, 300) || game.image
              return (
                <div
                  key={game.id}
                  className="recent-game-card"
                  onClick={() => handleGameClick(game.id)}
                >
                  <div className="recent-game-cover">
                    <img
                      src={imgUrl}
                      alt={game.title}
                      loading="lazy"
                      onError={(e) => {
                        e.target.src = `https://via.placeholder.com/120x160/152035/C8965A?text=${encodeURIComponent(game.title?.charAt(0) || '?')}`
                      }}
                    />
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
        </div>
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
                {allReviews.map((review, index) => (
                  <div
                    key={index}
                    className="review-item"
                    onClick={() => handleGameClick(review.gameId)}
                  >
                    {review.gameImage && (
                      <img
                        src={review.gameImage}
                        alt={review.gameTitle}
                        className="review-item-image"
                      />
                    )}
                    <div className="review-item-content">
                      <h3>{review.gameTitle}</h3>
                      <div className="review-item-rating">
                        <StarRating rating={parseFloat(review.rating)} size={18} />
                      </div>
                      <p className="review-item-text">{review.text}</p>
                      <span className="review-item-date">
                        {new Date(review.date).toLocaleDateString()}
                        {review.hoursPlayed > 0 && ` \u2022 ${review.hoursPlayed}h played`}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="empty-state">
                <h3>No Reviews Yet</h3>
                <p>Start reviewing games to share your thoughts!</p>
                <button onClick={() => navigate('/')} className="browse-button">
                  Browse Games
                </button>
              </div>
            )}
          </div>
        )}

        {activeTab === 'lists' && (
          <div className="tab-pane">
            <div className="lists-container">
              <div className="list-section">
                <h3 className="list-section-title">Want to Play</h3>
                {wantToPlayGames.length > 0 ? (
                  <div className="games-grid">
                    {wantToPlayGames.slice(0, 12).map((game) => (
                      <GameCard key={game.id} game={game} />
                    ))}
                  </div>
                ) : (
                  <div className="empty-list">
                    <p>No games in your &ldquo;Want to Play&rdquo; list</p>
                  </div>
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
                  <div className="empty-list">
                    <p>No games in your &ldquo;Currently Playing&rdquo; list</p>
                  </div>
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
                  <div className="empty-list">
                    <p>No games in your &ldquo;Played&rdquo; list</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {activeTab === 'activity' && (
          <div className="tab-pane">
            <ActivityFeed limit={10} />
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
  )
}

export default Profile
