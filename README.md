# GameTracker - Video Game Library App

A video game tracking app similar to Goodreads with a Spotify-like UI. Track your games, rate them, and discover new titles using real game data from the IGDB API.

## Features

- 🎮 Beautiful Spotify-inspired UI with Circular font
- 🔍 Search games using IGDB API
- 📚 Your Library - Save games to your personal collection
- ⭐ Wishlist - Keep track of games you want to play
- 📝 Reviews - Review and rate games
- 🌐 Full navigation between all pages
- 📊 Real-time game data from IGDB API

## Getting Started

### Prerequisites

You'll need an IGDB API key to use this app:

1. Create a Twitch account (if you don't have one)
2. Enable Two-Factor Authentication on your Twitch account
3. Register your application at [Twitch Developer Portal](https://dev.twitch.tv/console/apps)
4. Copy your Client ID and Client Secret

### Installation

```bash
npm install
```

### Configuration

1. Copy `.env.example` to `.env`:
```bash
cp .env.example .env
```

2. Add your IGDB API credentials to `.env`:
```
VITE_IGDB_CLIENT_ID=your_client_id_here
VITE_IGDB_CLIENT_SECRET=your_client_secret_here
```

### Development

```bash
npm run dev
```

The app will be available at `http://localhost:5173`

### Build

```bash
npm run build
```

## Project Structure

- `src/pages/` - Page components
  - `Home.jsx` - Main home page with featured games from IGDB
  - `Search.jsx` - Search games using IGDB API
  - `Library.jsx` - Your personal game library
  - `Wishlist.jsx` - Games you want to play
  - `Reviews.jsx` - Your game reviews

- `src/components/` - Reusable components
  - `Sidebar.jsx` - Navigation sidebar with routing
  - `GameSection.jsx` - Section component for displaying game collections
  - `GameCard.jsx` - Individual game card component

- `src/services/` - API services
  - `igdb.js` - IGDB API integration with authentication

## Technologies

- React 18
- React Router DOM 6
- Vite
- IGDB API (via Twitch OAuth)
- CSS3 with Circular font styling

## Navigation

The app includes full navigation between all pages:
- **Home** - Browse featured, recent, RPG, and indie games
- **Search** - Search for games using the IGDB database
- **Your Library** - View games you've added to your collection
- **Wishlist** - Manage games you want to play
- **Reviews** - View and manage your game reviews

## API Setup

The app uses the IGDB (Internet Game Database) API, which requires Twitch authentication:

1. Register at [Twitch Developer Portal](https://dev.twitch.tv/console/apps)
2. Create a new application
3. Copy your Client ID and Client Secret
4. Add them to your `.env` file

The app automatically handles OAuth token management and refreshing.

