import React, { useCallback, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { LuCheck } from 'react-icons/lu'
import {
  getThemeSettings,
  setMatchSystem,
  setTheme,
} from '../../services/themeService'
import { THEME_ORDER, THEMES } from '../../styles/themePreview'
import { hapticImpact } from '../../utils/haptics'
import './ThemeStep.css'

// Built from THEME_ORDER, so a new theme shows up here with no edit.
const DARK_THEMES = THEME_ORDER.filter((id) => THEMES[id].mode === 'dark').map((id) => THEMES[id])
const LIGHT_THEMES = THEME_ORDER.filter((id) => THEMES[id].mode === 'light').map((id) => THEMES[id])

/** The theme on screen right now (themeService stamps it on <html>). */
function currentThemeId() {
  const id = document.documentElement.getAttribute('data-app-theme')
  return THEMES[id] ? id : 'navy'
}

/**
 * A tile is a small painted swatch of the theme itself: its page background, a
 * surface card, and its three accent dots. Those colors come from THEMES data
 * as inline values, the same way SettingsAppearance paints its tiles.
 */
function ThemeTile({ theme, selected, onSelect }) {
  return (
    <button
      type="button"
      className={`ob-tile${selected ? ' ob-tile--on' : ''}`}
      aria-label={`${theme.name} theme`}
      aria-pressed={selected}
      onClick={() => onSelect(theme.id)}
    >
      <span className="ob-tile__sw" style={{ background: theme.base }} aria-hidden="true">
        <span className="ob-tile__dots">
          <i style={{ background: theme.primary }} />
          <i style={{ background: theme.review }} />
          <i style={{ background: theme.journal }} />
        </span>
        <span className="ob-tile__card" style={{ background: theme.surface }} />
        <span className="ob-tile__ck">
          <LuCheck size={12} strokeWidth={3} />
        </span>
      </span>
      <span className="ob-tile__nm">{theme.name}</span>
    </button>
  )
}

function ThemeSection({ label, themes, selectedId, onSelect }) {
  return (
    <section>
      <h2 className="ob-sec text-label">{label}</h2>
      <div className="ob-tiles">
        {themes.map((theme) => (
          <ThemeTile
            key={theme.id}
            theme={theme}
            selected={theme.id === selectedId}
            onSelect={onSelect}
          />
        ))}
      </div>
    </section>
  )
}

/**
 * Step 1, "Make it yours". The screen is its own preview: a tap recolors
 * everything (a ~320 ms crossfade of the whole page where the browser can do
 * one), the mascot hops, and the pick is saved on the spot.
 */
export default function ThemeStep({ reduced }) {
  const [selectedId, setSelectedId] = useState(currentThemeId)
  const mascotRef = useRef(null)

  // Restart the hop on every pick: drop the class, force a reflow, add it back.
  const hop = useCallback(() => {
    const el = mascotRef.current
    if (!el || reduced) return
    el.classList.remove('ob-mascot--hop')
    void el.offsetWidth
    el.classList.add('ob-mascot--hop')
  }, [reduced])

  const handlePick = useCallback(
    (id) => {
      const matchSystem = getThemeSettings().matchSystem
      // Already showing this theme and it is a real pick, not "match iPhone":
      // nothing would change.
      if (id === selectedId && !matchSystem) return
      hapticImpact('Light')

      const apply = () => {
        // A pick is a choice, so it ends "match iPhone light and dark".
        if (matchSystem) setMatchSystem(false)
        setTheme(id)
        // Inside the transition callback so the new ring is in the new frame.
        flushSync(() => setSelectedId(id))
        hop()
      }

      if (!reduced && typeof document.startViewTransition === 'function') {
        const root = document.documentElement
        root.classList.add('ob-theme-vt')
        const done = () => root.classList.remove('ob-theme-vt')
        document.startViewTransition(apply).finished.then(done, done)
      } else {
        apply()
      }
    },
    [selectedId, reduced, hop],
  )

  return (
    <>
      <div className="ob-tw">
        <div className="ob-tw__copy">
          <h1 className="ob-title text-display-l">Make it yours</h1>
          <p className="ob-sub text-body">
            Pick a look. Tap any theme and the whole app changes with it.
          </p>
        </div>
        <img
          ref={mascotRef}
          className="ob-mascot"
          src="/brand/checkpoint-splash-1x.png"
          srcSet="/brand/checkpoint-splash-1x.png 1x, /brand/checkpoint-splash-2x.png 2x, /brand/checkpoint-splash-3x.png 3x"
          width={51}
          height={84}
          alt=""
          aria-hidden="true"
          draggable={false}
        />
      </div>

      <ThemeSection label="Dark" themes={DARK_THEMES} selectedId={selectedId} onSelect={handlePick} />
      <ThemeSection label="Light" themes={LIGHT_THEMES} selectedId={selectedId} onSelect={handlePick} />

      <p className="ob-note text-caption">Change it anytime in Settings → Appearance.</p>
    </>
  )
}
