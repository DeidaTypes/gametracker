// Review Service - handles storing and retrieving reviews

const STORAGE_KEY = 'gameReviews'

// Save a review
export function saveReview(review) {
  const reviews = getAllReviews()
  reviews.push(review)
  localStorage.setItem(STORAGE_KEY, JSON.stringify(reviews))
  
  // Update review count
  updateReviewCount()
}

// Get all reviews
export function getAllReviews() {
  const stored = localStorage.getItem(STORAGE_KEY)
  return stored ? JSON.parse(stored) : []
}

// Get reviews for a specific game
export function getReviewsByGameId(gameId) {
  const reviews = getAllReviews()
  return reviews.filter((review) => review.gameId === gameId.toString())
}

// Get user's review count
export function getUserReviewCount() {
  const reviews = getAllReviews()
  return reviews.length
}

// Update review count in localStorage
function updateReviewCount() {
  const count = getUserReviewCount()
  localStorage.setItem('userReviewCount', count.toString())
  return count
}

// Delete a review (optional feature)
export function deleteReview(reviewIndex) {
  const reviews = getAllReviews()
  reviews.splice(reviewIndex, 1)
  localStorage.setItem(STORAGE_KEY, JSON.stringify(reviews))
  updateReviewCount()
}

// Get review count for display
export function getReviewCount() {
  const stored = localStorage.getItem('userReviewCount')
  return stored ? parseInt(stored) : 0
}

