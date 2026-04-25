# Mobile "Top Games of the Week" Feature

## Overview
Implemented a mobile-specific "Top Games of the Week" section displaying **18 trending games** in a clean **3-column × 6-row grid**.

## ✅ Features Delivered

### 1. **Mobile-Only Display**
- ✅ Shows **ONLY on mobile** (screen width ≤ 768px)
- ✅ Hidden on desktop/tablet (≥ 769px)
- ✅ Responsive window resize detection
- ✅ Dynamic rendering based on screen size

### 2. **3-Column × 6-Row Grid**
- ✅ **3 horizontal cards** per row
- ✅ **6 rows** total
- ✅ **18 games total** (3 × 6 = 18)
- ✅ Compact, space-efficient layout

### 3. **Top Games of the Week API**
- ✅ Fetches trending games from last 2 weeks
- ✅ Sorted by rating_count (popularity)
- ✅ Falls back to 3-month window if needed
- ✅ Further falls back to popular games if no recent games

### 4. **Responsive Spacing**
- ✅ **Standard mobile** (≤768px): 10px gap
- ✅ **Small screens** (≤480px): 8px gap
- ✅ Optimized for various phone sizes

## Visual Layout

### Mobile View (375px × 812px):
```
┌─────────────────────────────────────┐
│  Good evening                       │
│                                     │
│  TOP GAMES OF THE WEEK             │
│  ┌────┐  ┌────┐  ┌────┐   Row 1   │
│  │Game│  │Game│  │Game│            │
│  └────┘  └────┘  └────┘            │
│                                     │
│  ┌────┐  ┌────┐  ┌────┐   Row 2   │
│  │Game│  │Game│  │Game│            │
│  └────┘  └────┘  └────┘            │
│                                     │
│  ┌────┐  ┌────┐  ┌────┐   Row 3   │
│  │Game│  │Game│  │Game│            │
│  └────┘  └────┘  └────┘            │
│                                     │
│  ┌────┐  ┌────┐  ┌────┐   Row 4   │
│  │Game│  │Game│  │Game│            │
│  └────┘  └────┘  └────┘            │
│                                     │
│  ┌────┐  ┌────┐  ┌────┐   Row 5   │
│  │Game│  │Game│  │Game│            │
│  └────┘  └────┘  └────┘            │
│                                     │
│  ┌────┐  ┌────┐  ┌────┐   Row 6   │
│  │Game│  │Game│  │Game│            │
│  └────┘  └────┘  └────┘            │
│                                     │
│  [Other sections below...]          │
└─────────────────────────────────────┘
```

## Technical Implementation

### Files Modified:

#### 1. **src/services/igdb.js**
Added new function:
```javascript
export async function getTopGamesOfTheWeek(limit = 20) {
  // Get games from last 2 weeks, sorted by rating_count
  const twoWeeksAgo = Math.floor(Date.now() / 1000) - (14 * 24 * 60 * 60)
  // ... query for trending games
  // Fallback to 3 months if not enough recent
  // Further fallback to popular games
}
```

#### 2. **src/pages/Home.jsx**
- Added mobile detection: `useState(window.innerWidth <= 768)`
- Added window resize listener
- Fetch weekly games on mobile
- Render mobile-specific section:
```javascript
{isMobile && topWeeklyGames.length > 0 && (
  <div className="mobile-weekly-section">
    <div className="mobile-weekly-grid">
      {topWeeklyGames.slice(0, 18).map((game) => (
        <GameCard key={game.id} game={game} />
      ))}
    </div>
  </div>
)}
```

#### 3. **src/pages/Home.css**
Added mobile-specific CSS:
```css
.mobile-weekly-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
}

@media (min-width: 769px) {
  .mobile-weekly-section {
    display: none; /* Hide on desktop */
  }
}
```

## Game Selection Logic

### Primary Query (Last 2 Weeks):
- Games released in last 14 days
- Has cover image
- Has rating and rating_count
- Sorted by rating_count (most popular first)

### Fallback Query (Last 3 Months):
- If not enough recent games found
- Expands to 90-day window
- Same quality criteria

### Final Fallback:
- Uses `getPopularGames()` function
- Ensures users always see content

## Benefits

### ✅ **Mobile-Optimized**
- Perfect for touch navigation
- Easy to scan grid layout
- Compact, efficient use of space

### ✅ **Trending Content**
- Shows what's popular RIGHT NOW
- Updated from API
- Relevant to current gaming trends

### ✅ **User Experience**
- Quick access to hot games
- No scrolling through categories
- Immediate visual impact

### ✅ **Responsive Design**
- Works on all phone sizes
- Adapts gap spacing
- Professional appearance

## Real Data from Testing

### Desktop (1440px):
- ❌ "Top Games of the Week" section HIDDEN
- ✅ Shows regular category layout (Featured, New & Trending, etc.)
- ✅ No performance impact

### Mobile (375px):
- ✅ "Top Games of the Week" section VISIBLE at top
- ✅ Exactly **18 games** displayed
- ✅ **3 columns × 6 rows** grid
- ✅ Games shown:
  - Row 1: Master Lemon, Dispatch, Hollow Knight: Silksong
  - Row 2: Metal Gear Solid Delta, ARC Raiders, Legend of Ymir
  - Row 3: Digimon Story, Megabonk, Battlefield REDSEC
  - Row 4: Hades II, Dragon Ball, Suck Up!
  - Row 5: Farthest Frontier, Keeper, Pokémon Legends
  - Row 6: Arena Breakout, No I'm Not A Human, Ghost of Yotei

### Mobile Console Logs:
```
✅ Top games of the week: 18
🎮 Showing mobile layout with 3-column grid
```

## CSS Breakdown

### Grid Layout:
- `display: grid`
- `grid-template-columns: repeat(3, 1fr)` - Equal 3 columns
- `gap: 10px` - Spacing between cards
- `width: 100%` - Full width

### Responsive Gaps:
- **768px and below**: 10px gap
- **480px and below**: 8px gap (tighter on small phones)

### Section Styling:
- Inherits section header styling
- Matches existing game section design
- Consistent with app theme

## Additional Features

### Window Resize Handling:
- Listens for window resize events
- Dynamically switches between mobile/desktop
- Re-fetches data when switching modes
- Smooth transition

### Smart Data Fetching:
- Only fetches weekly games when on mobile
- Saves API calls on desktop
- Efficient resource usage

## User Experience Flow

### On Mobile:
1. Open app → See "Good evening"
2. Immediately see "TOP GAMES OF THE WEEK"
3. See 18 trending games in clean 3×6 grid
4. Scroll down for personalized sections
5. Bottom nav always accessible

### On Desktop:
1. Open app → See "Good evening"  
2. See "Featured" category first
3. Standard category layout
4. No weekly section (doesn't need it)

## Performance

### Load Time:
- Mobile: +1 API call (weekly games)
- Desktop: No change
- Total: Negligible impact

### Memory:
- 18 additional game objects on mobile
- Minimal memory footprint
- Efficient React rendering

## Future Enhancements (Optional)

1. **Swipe Navigation** - Horizontal swipe through weekly games
2. **Auto-Refresh** - Update weekly games daily
3. **Custom Filters** - Let users choose "Week/Month/Year"
4. **Ranking Numbers** - Show #1, #2, #3 badges
5. **Trending Indicators** - Show "🔥 Trending" or "⬆️ Rising" badges

## Summary

✅ **Mobile-specific feature** for better mobile UX  
✅ **3 columns × 6 rows** = 18 trending games  
✅ **API-driven** from IGDB top games of the week  
✅ **Responsive** across all mobile sizes  
✅ **Hidden on desktop** to avoid redundancy  
✅ **Performance optimized** with smart fetching  

The mobile app now has a **premium, focused gaming experience** with trending content front and center! 📱🎮

