import { rawgRequest, formatGames } from './rawg'

const CATEGORY_DEFS = [
  {
    key: 'top-rated',
    label: 'Top Rated',
    color: '#7B2D8B',
    pinned: true,
    fetch: () => fetchTopRated(),
  },
  {
    key: 'new-releases',
    label: 'New Releases',
    color: '#1A6B3A',
    pinned: true,
    fetch: () => fetchNewReleases(),
  },
  {
    key: 'action',
    label: 'Action',
    color: '#C44B1B',
    fetch: () => fetchByGenre('action'),
  },
  {
    key: 'rpg',
    label: 'RPG',
    color: '#8B1A1A',
    fetch: () => fetchByGenre('role-playing-games-rpg'),
  },
  {
    key: 'multiplayer',
    label: 'Multiplayer',
    color: '#1A5F7A',
    fetch: () => fetchByTag('multiplayer'),
  },
  {
    key: 'hidden-gems',
    label: 'Hidden Gems',
    color: '#6B3A8B',
    fetch: () => fetchHiddenGems(),
  },
  {
    key: 'classic-hits',
    label: 'Classic Hits',
    color: '#1A3A6B',
    fetch: () => fetchClassicHits(),
  },
  {
    key: 'most-reviewed',
    label: 'Most Reviewed',
    color: '#8B6B1A',
    fetch: () => fetchMostReviewed(),
  },
  {
    key: 'open-world',
    label: 'Open World',
    color: '#2D6B1A',
    fetch: () => fetchByTag('open-world'),
  },
  {
    key: 'indie',
    label: 'Indie',
    color: '#8B1A4B',
    fetch: () => fetchByTag('indie'),
  },
]

function today() {
  return new Date().toISOString().split('T')[0]
}

function daysAgo(days) {
  return new Date(Date.now() - days * 86400000).toISOString().split('T')[0]
}

async function fetchTopRated() {
  const data = await rawgRequest('/games', {
    ordering: '-rating',
    page_size: 10,
  })
  return formatGames(data.results || [])
}

async function fetchNewReleases() {
  const data = await rawgRequest('/games', {
    dates: `${daysAgo(90)},${today()}`,
    ordering: '-rating',
    page_size: 10,
  })
  return formatGames(data.results || [])
}

async function fetchByGenre(genreSlug) {
  const data = await rawgRequest('/games', {
    genres: genreSlug,
    ordering: '-rating',
    page_size: 10,
  })
  return formatGames(data.results || [])
}

async function fetchByTag(tagSlug) {
  const data = await rawgRequest('/games', {
    tags: tagSlug,
    ordering: '-rating',
    page_size: 10,
  })
  return formatGames(data.results || [])
}

async function fetchHiddenGems() {
  const data = await rawgRequest('/games', {
    ordering: '-rating',
    page_size: 50,
  })
  const gems = (data.results || []).filter(
    (g) => g.ratings_count < 500 && g.rating > 4.0
  )
  return formatGames(gems.slice(0, 10))
}

async function fetchClassicHits() {
  const data = await rawgRequest('/games', {
    dates: '1980-01-01,2009-12-31',
    ordering: '-rating',
    page_size: 10,
  })
  return formatGames(data.results || [])
}

async function fetchMostReviewed() {
  const data = await rawgRequest('/games', {
    ordering: '-ratings_count',
    page_size: 10,
  })
  return formatGames(data.results || [])
}

function pickRandom(arr) {
  if (!arr || arr.length === 0) return null
  return arr[Math.floor(Math.random() * arr.length)]
}

function shuffleNonPinned(categories) {
  const pinned = categories.filter((c) => c.pinned)
  const rest = categories.filter((c) => !c.pinned)
  for (let i = rest.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[rest[i], rest[j]] = [rest[j], rest[i]]
  }
  return [...pinned, ...rest]
}

export function getCategoryDefinitions() {
  return CATEGORY_DEFS
}

export async function fetchBrowseCategories() {
  const results = await Promise.allSettled(
    CATEGORY_DEFS.map(async (cat) => {
      const games = await cat.fetch()
      const coverGame = pickRandom(games.slice(0, 10))
      return {
        key: cat.key,
        label: cat.label,
        color: cat.color,
        pinned: !!cat.pinned,
        coverImage: coverGame?.image || null,
        games,
      }
    })
  )

  const fulfilled = results
    .map((r, i) => {
      if (r.status === 'fulfilled') return r.value
      return {
        key: CATEGORY_DEFS[i].key,
        label: CATEGORY_DEFS[i].label,
        color: CATEGORY_DEFS[i].color,
        pinned: !!CATEGORY_DEFS[i].pinned,
        coverImage: null,
        games: [],
        failed: true,
      }
    })

  return shuffleNonPinned(fulfilled)
}

export async function fetchCategoryGames(categoryKey) {
  const def = CATEGORY_DEFS.find((c) => c.key === categoryKey)
  if (!def) return []
  return def.fetch()
}
