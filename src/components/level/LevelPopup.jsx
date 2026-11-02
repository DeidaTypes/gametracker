import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { nextRewards, xpForLevel, xpSourceLabel } from '../../data/levels'
import { getLibrary, initializeLibrary } from '../../services/libraryService'
import { getMyRecentXp, getMyXpToday } from '../../services/xpService'
import { APP_RESUMED_EVENT, isLongAbsence } from '../../hooks/useAppResume'
import CenteredModal from '../CenteredModal'
import { Arrive } from '../motion/ContentSwap'
import { LevelProgressRing, GAME_SOURCES } from './ProfileLevelRow'
import './LevelPopup.css'

const MERGE_SOURCES = {
  heart_received: (count) =>
    `${count} heart${count === 1 ? '' : 's'} on your posts`,
  heart_given: (count) =>
    `${count} heart${count === 1 ? '' : 's'} given`,
  comment: (count) =>
    `${count} comment${count === 1 ? '' : 's'}`,
  follow: (count) =>
    `${count} player${count === 1 ? '' : 's'} followed`,
}

function dayKey(iso) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
}

function formatXpDay(iso) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const startOfToday = new Date()
  startOfToday.setHours(0, 0, 0, 0)
  const startOfThen = new Date(d)
  startOfThen.setHours(0, 0, 0, 0)
  const diffDays = Math.round((startOfToday - startOfThen) / (24 * 60 * 60 * 1000))
  if (diffDays === 0) return 'Today'
  if (diffDays === 1) return 'Yesterday'
  return d.toLocaleDateString('en-US', { weekday: 'short', day: 'numeric' })
}

function libraryTitleForRef(ref) {
  const id = String(ref ?? '')
  if (!id) return ''
  const library = getLibrary() || initializeLibrary()
  const lists = [
    ...Object.values(library.lists || {}),
    ...Object.values(library.customLists || {}),
  ]
  for (const list of lists) {
    for (const game of list.games || []) {
      if (game?.id != null && String(game.id) === id && game.title) {
        return game.title
      }
    }
  }
  return ''
}

function buildRecentLines(rows) {
  const lines = []
  let i = 0
  while (i < rows.length && lines.length < 8) {
    const row = rows[i]
    const source = row.source
    const day = dayKey(row.createdAt)
    const mergeLabel = MERGE_SOURCES[source]

    if (mergeLabel) {
      let amount = 0
      let count = 0
      let j = i
      while (
        j < rows.length
        && rows[j].source === source
        && dayKey(rows[j].createdAt) === day
      ) {
        amount += rows[j].amount
        count += 1
        j += 1
      }
      lines.push({
        label: mergeLabel(count),
        amount,
        dateIso: row.createdAt,
      })
      i = j
    } else {
      let label = xpSourceLabel(source, row.ref)
      if (GAME_SOURCES.has(source)) {
        const title = libraryTitleForRef(row.ref)
        if (title) label += ` \u00b7 ${title}`
      }
      if (label) {
        lines.push({
          label,
          amount: row.amount,
          dateIso: row.createdAt,
        })
      }
      i += 1
    }
  }
  return lines
}

/**
 * LevelPopup — centered level details (profile avatar tag + level row).
 */
export default function LevelPopup({
  isOpen,
  onClose,
  isOwnProfile = false,
  level = 1,
  progress,
  rank,
  xpTotal = 0,
}) {
  const [todayXp, setTodayXp] = useState(0)
  const [recentRows, setRecentRows] = useState([])
  const [extrasReady, setExtrasReady] = useState(false)

  const loadExtras = useCallback(async () => {
    if (!isOwnProfile) {
      setTodayXp(0)
      setRecentRows([])
      setExtrasReady(true)
      return
    }
    setExtrasReady(false)
    try {
      const [today, recent] = await Promise.all([
        getMyXpToday(),
        getMyRecentXp(30),
      ])
      setTodayXp(today)
      setRecentRows(recent)
    } catch (err) {
      console.error('[level] popup extras failed:', err)
      setTodayXp(0)
      setRecentRows([])
    } finally {
      setExtrasReady(true)
    }
  }, [isOwnProfile])

  useEffect(() => {
    if (!isOpen) return undefined
    loadExtras()
    const onXp = () => {
      loadExtras().catch(() => {})
    }
    const onResume = (event) => {
      if (!isLongAbsence(event)) return
      loadExtras().catch(() => {})
    }
    window.addEventListener('xpUpdated', onXp)
    window.addEventListener(APP_RESUMED_EVENT, onResume)
    return () => {
      window.removeEventListener('xpUpdated', onXp)
      window.removeEventListener(APP_RESUMED_EVENT, onResume)
    }
  }, [isOpen, loadExtras])

  const isMax = progress?.isMax
  const rewards = useMemo(
    () => (isMax ? [] : nextRewards(level, 3)),
    [isMax, level]
  )

  const recentLines = useMemo(
    () => (isOwnProfile ? buildRecentLines(recentRows) : []),
    [isOwnProfile, recentRows]
  )

  const levelProgressLine = isMax
    ? 'Max level'
    : progress
      ? `${progress.intoLevel.toLocaleString()} / ${progress.levelCost.toLocaleString()} XP this level`
      : ''

  const totalLine = isOwnProfile
    ? [
        todayXp > 0 ? `Today +${todayXp.toLocaleString()} XP` : null,
        `${xpTotal.toLocaleString()} XP total`,
      ]
        .filter(Boolean)
        .join(' \u00b7 ')
    : `${xpTotal.toLocaleString()} XP total`

  const ready = progress != null && (!isOwnProfile || extrasReady)

  return (
    <CenteredModal
      isOpen={isOpen}
      onClose={onClose}
      ariaLabel={`Level ${level}`}
      maxWidth={400}
      className="lp-card"
    >
      <header className="lp-top">
        <span aria-hidden="true" />
        <h2 className="lp-top__name text-title">Level {level}</h2>
        <button type="button" className="lp-top__done" onClick={onClose}>
          Done
        </button>
      </header>

      <div className="cm-scroll lp-body">
        <Arrive
          ready={ready}
          placeholder={
            <div className="lp-summary lp-summary--placeholder" aria-hidden="true" />
          }
        >
          <section className="lp-summary" aria-label="Level progress">
            <LevelProgressRing
              size={96}
              stroke={7}
              level={level}
              fraction={progress?.fraction ?? 0}
              className="level-ring--popup"
            />
            <p className="lp-summary__rank text-label">{rank?.name}</p>
            <p className="lp-summary__level-xp text-caption">{levelProgressLine}</p>
            <p className="lp-summary__totals text-caption">{totalLine}</p>
          </section>
        </Arrive>

        {!isMax && rewards.length > 0 && (
          <>
            <h3 className="lp-section-label text-label">Next rewards</h3>
            <div className="lp-inset" role="list">
              {rewards.map((reward) => {
                const away = Math.max(0, xpForLevel(reward.level) - xpTotal)
                return (
                  <div key={reward.level} className="lp-reward-row" role="listitem">
                    <span className="lp-reward-row__lvl">Lv {reward.level}</span>
                    <span className="lp-reward-row__text">
                      <span className="lp-reward-row__name">{reward.name}</span>
                      <span className="lp-reward-row__away text-caption">
                        {away.toLocaleString()} XP away
                      </span>
                    </span>
                  </div>
                )
              })}
            </div>
          </>
        )}

        {isOwnProfile && recentLines.length > 0 && (
          <>
            <h3 className="lp-section-label text-label">Recent XP</h3>
            <div className="lp-inset" role="list">
              {recentLines.map((line, idx) => (
                <div key={`${line.label}-${line.dateIso}-${idx}`} className="lp-xp-row" role="listitem">
                  <span className="lp-xp-row__main">
                    <span className="lp-xp-row__label">{line.label}</span>
                    <span className="lp-xp-row__when text-caption">
                      {formatXpDay(line.dateIso)}
                    </span>
                  </span>
                  <span className="lp-xp-row__amount">+{line.amount}</span>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </CenteredModal>
  )
}
