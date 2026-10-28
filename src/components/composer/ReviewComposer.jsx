import React, { useState, useEffect, useCallback, useRef } from 'react'
import { StarRatingInput } from '../forms'
import GamePickerSheet from '../GamePickerSheet'
import CenteredModal from '../CenteredModal'
import IOSSwitch from '../IOSSwitch'
import { discardConfirm, useConfirmSheet } from '../ConfirmSheet'
import { getGameById } from '../../services/igdb'
import { postReview, updateReview } from '../../services/reviewService'
import { logActivity, ACTIVITY_TYPES } from '../../services/activityService'
import { logCompletedEventOnce } from '../../services/activityEventsService'
import { showToast } from '../Toast'
import { hapticSuccess } from '../../utils/haptics'
import { ugcErrorMessage } from '../../services/moderationService'
import '../forms/forms.css'
import '../../pages/ReviewNew.css'

const PROMPT_CHIPS = [
  { id: 'story',       label: 'Story',       starter: 'The story ' },
  { id: 'gameplay',    label: 'Gameplay',    starter: 'The gameplay ' },
  { id: 'visuals',     label: 'Visuals',     starter: 'The visuals ' },
  { id: 'music',       label: 'Music',       starter: 'The music ' },
  { id: 'characters',  label: 'Characters',  starter: 'The characters ' },
  { id: 'atmosphere',  label: 'Atmosphere',  starter: 'The atmosphere ' },
]

const VIBE_STAMPS = [
  { id: 'masterpiece', label: 'Masterpiece' },
  { id: 'underrated',  label: 'Underrated'  },
  { id: 'mid',         label: 'Mid'         },
  { id: 'rage_quit',   label: 'Rage Quit'   },
  { id: 'comfort',     label: 'Comfort'     },
]

const LIFE_CONTEXTS = [
  { id: 'childhood',   label: 'Childhood'   },
  { id: 'teen_years',  label: 'Teen Years'  },
  { id: 'college',     label: 'College'     },
  { id: 'burnout',     label: 'Burnout'     },
  { id: 'healing',     label: 'Healing'     },
  { id: 'traveling',   label: 'Traveling'   },
  { id: 'new_chapter', label: 'New Chapter' },
]

/**
 * The review box. Presented in a CenteredModal and driven entirely by props,
 * so it can open over any page (ComposerHost) or over the /review/new
 * fallback route without either one owning its state.
 *
 * Props:
 *   game        the game being reviewed, when the caller already has it
 *   gameId      fetched when `game` is missing (old /review/new?gameId= links)
 *   editReview  ReviewCard-shape object (id, rating, body, hoursPlayed, liked,
 *               hasSpoilers, vibeStamp, lifeContext) when editing your own review
 *   onSaved     (result) => void, called once the write has succeeded
 *   onClose     () => void, called after the box has finished fading out
 *               (Save and Cancel both end here). It is the only exit.
 */
function ReviewComposer({ game: gameProp = null, gameId = null, editReview = null, onSaved, onClose }) {
  const isEditMode = !!editReview

  const targetId = gameId ?? gameProp?.id ?? null
  const propMatches = !!gameProp && (targetId == null || String(gameProp.id) === String(targetId))

  const [game, setGame] = useState(propMatches ? gameProp : null)
  const [loadingGame, setLoadingGame] = useState(!propMatches && targetId != null)
  const [gameError, setGameError] = useState(null)

  // Composer state — initialised from the existing review in edit mode.
  const [rating, setRating] = useState(isEditMode ? (editReview.rating ?? 0) : 0)
  const [text, setText] = useState(isEditMode ? (editReview.body ?? '') : '')
  const [hoursRaw, setHoursRaw] = useState(() => {
    if (!isEditMode) return '0'
    const h = editReview.hoursPlayed ?? 0
    return h % 1 === 0 ? String(h) : Number(h).toFixed(1)
  })
  const [loved, setLoved] = useState(isEditMode ? (editReview.liked ?? false) : false)
  const [containsSpoilers, setContainsSpoilers] = useState(
    isEditMode ? (editReview.hasSpoilers ?? false) : false
  )
  // markCompleted is a create-only action — irrelevant when editing an
  // existing review, so we hide the toggle entirely in edit mode.
  const [markCompleted, setMarkCompleted] = useState(false)
  const [vibeStamp, setVibeStamp] = useState(isEditMode ? (editReview.vibeStamp ?? null) : null)
  const [lifeContext, setLifeContext] = useState(isEditMode ? (editReview.lifeContext ?? null) : null)
  const [submitting, setSubmitting] = useState(false)
  const [saveError, setSaveError] = useState(null)
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [confirm, confirmSheet] = useConfirmSheet()

  // Drives the popup enter/exit animation. Closing flips this to false; the
  // box fades out, then `onExited` hands control back through onClose.
  const [open, setOpen] = useState(true)
  const [usesPicker] = useState(!propMatches && targetId == null && !isEditMode)
  const [pickerCancelled, setPickerCancelled] = useState(false)

  const closeBox = useCallback(() => setOpen(false), [])

  const handleExited = useCallback(() => {
    onClose?.()
  }, [onClose])

  // Fetch the game only when the caller did not hand it over.
  useEffect(() => {
    if (propMatches) {
      setGame(gameProp)
      setLoadingGame(false)
      return undefined
    }
    if (targetId == null) return undefined

    let cancelled = false
    setLoadingGame(true)
    setGameError(null)

    getGameById(targetId)
      .then((g) => { if (!cancelled) setGame(g) })
      .catch((err) => {
        console.error('[ReviewComposer] failed to load game:', err)
        if (!cancelled) setGameError('Could not load game details.')
      })
      .finally(() => { if (!cancelled) setLoadingGame(false) })

    return () => { cancelled = true }
  }, [targetId, gameProp, propMatches])

  const hasInput = rating > 0 || text.trim().length > 0
  const canSave = !submitting && hasInput

  // In edit mode, only ask for discard confirmation when something changed.
  const isDirty = isEditMode
    ? rating !== (editReview.rating ?? 0) ||
      text.trim() !== (editReview.body ?? '').trim() ||
      (parseFloat(hoursRaw) || 0) !== (editReview.hoursPlayed ?? 0) ||
      loved !== (editReview.liked ?? false) ||
      containsSpoilers !== (editReview.hasSpoilers ?? false) ||
      vibeStamp !== (editReview.vibeStamp ?? null) ||
      lifeContext !== (editReview.lifeContext ?? null)
    : hasInput

  const handleCancel = useCallback(async () => {
    if (isDirty && !(await confirm(discardConfirm('review', { editing: isEditMode })))) return
    closeBox()
  }, [isDirty, isEditMode, closeBox, confirm])

  const handleSave = useCallback(async () => {
    if (!canSave) return
    if (!isEditMode && !game) return
    setSubmitting(true)
    setSaveError(null)
    try {
      const deadline = new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error('Request timed out. Please check your connection.')),
          12000
        )
      )

      let result
      if (isEditMode) {
        result = await Promise.race([
          updateReview(editReview.id, {
            body: text.trim(),
            rating: Number(rating),
            liked: !!loved,
            hasSpoilers: !!containsSpoilers,
            hoursPlayed: Math.min(parseFloat(hoursRaw) || 0, 9999),
            vibeStamp: vibeStamp || null,
            lifeContext: lifeContext || null,
          }),
          deadline,
        ])
      } else {
        result = await Promise.race([
          postReview({
            igdbGameId: game.id,
            body: text.trim(),
            rating: Number(rating),
            liked: !!loved,
            hasSpoilers: !!containsSpoilers,
            gameTitle: game.title,
            gameImage: game.image,
            hoursPlayed: Math.min(parseFloat(hoursRaw) || 0, 9999),
            vibeStamp: vibeStamp || null,
            lifeContext: lifeContext || null,
          }),
          deadline,
        ])

        // "Mark as completed" records the Challenge-eligible finish
        // event directly (the same `activities` shape
        // goalService.applyFinishedThisYearFilters reads: activity_type
        // 'status_changed' + metadata.to_status 'played') WITHOUT going
        // through setGameStatus. Decoupling fix: a review for a game the
        // user does not track must never create/modify a game_trackers
        // row — logActivity only ever writes to `activities`, so this is
        // exactly as safe for an untracked game as the toggle being off.
        // Fire-and-forget, same as setGameStatus's own activity write.
        //
        // It must ALSO emit the Pulse-side `activity_events` 'completed'
        // row — setGameStatus's own 'played' branch (libraryService.js)
        // writes:
        //   logActivityEvent({
        //     type: ACTIVITY_EVENT_TYPES.COMPLETED,
        //     entityId: String(gameId),
        //     metadata: {
        //       from_status: currentStatus || null,
        //       game_title: gameObj.title || null,
        //       game_image: gameObj.image || null,
        //     },
        //   })
        // Mirrored exactly below (from_status is always null here — a
        // review composer finish has no prior tracker status). Skipping
        // this write is exactly the bug that left the Home Pulse and the
        // 2026 Challenge disagreeing about which games were finished.
        // logCompletedEventOnce is idempotent on (actor_user_id,
        // entity_id) so resubmitting "Mark as completed" for the same
        // game never double-posts to Pulse.
        if (markCompleted) {
          logActivity({
            activityType: ACTIVITY_TYPES.STATUS_CHANGED,
            igdbGameId: game.id,
            metadata: {
              from_status: null,
              to_status: 'played',
              game_title: game.title || null,
            },
          })
          logCompletedEventOnce({
            entityId: game.id,
            metadata: {
              from_status: null,
              game_title: game.title || null,
              game_image: game.image || null,
            },
          })
        }
      }

      hapticSuccess()
      window.dispatchEvent(new Event('reviewAdded'))
      showToast(isEditMode ? 'Review updated' : 'Review saved', 'success', null, null, null, {
        sub: game?.title || null,
        tone: 'saved',
      })
      onSaved?.(result)
      closeBox()
    } catch (err) {
      console.error('[ReviewComposer] save failed:', err)
      const blocked = ugcErrorMessage(err)
      if (blocked) setSaveError(blocked)
      else showToast("Couldn't save your review", 'error', null, null, null, { sub: 'Try again' })
      setSubmitting(false)
    }
  }, [
    canSave, isEditMode, editReview, game,
    text, rating, loved, containsSpoilers, hoursRaw, markCompleted,
    vibeStamp, lifeContext,
    onSaved, closeBox,
  ])

  // No game yet: the picker hands one back and the box swaps in place.
  const handleGamePicked = useCallback((picked) => {
    setGame(picked)
  }, [])

  // Permit: empty, up-to-4 digits, optionally followed by a dot + one digit.
  const handleHoursChange = (e) => {
    const v = e.target.value
    if (!/^(\d{0,4}(\.\d?)?)?$/.test(v)) return
    setHoursRaw(v)
  }

  const handleHoursBlur = () => {
    const n = parseFloat(hoursRaw)
    if (!hoursRaw || isNaN(n) || n < 0) {
      setHoursRaw('0')
    } else {
      const clamped = Math.min(n, 9999)
      setHoursRaw(clamped % 1 === 0 ? String(clamped) : clamped.toFixed(1))
    }
  }

  const adjustHours = (delta) => {
    const current = parseFloat(hoursRaw) || 0
    const next = Math.max(0, Math.min(9999, Math.round((current + delta) * 10) / 10))
    setHoursRaw(next % 1 === 0 ? String(next) : next.toFixed(1))
  }

  const hoursInputRef = useRef(null)
  const textareaRef = useRef(null)

  const coverSrc = game?.image ?? null
  const developer = game?.developers?.[0] ?? game?.developer ?? null
  const gameMeta = [game?.year, developer].filter(Boolean).join(' · ')

  // ── No game yet + not edit mode → pick a game first ──────────────────
  // The picker stays mounted after a pick so it fades out while the box
  // fades in over the shared dim; Cancel closes only once it has faded.
  // Every return below keeps it in the same slot so it is never remounted.

  const picker = usesPicker ? (
    <GamePickerSheet
      isOpen={!game && !pickerCancelled}
      onSelect={handleGamePicked}
      onCancel={() => setPickerCancelled(true)}
      onExited={pickerCancelled ? () => onClose?.() : undefined}
    />
  ) : null
  const withPicker = (node) => <>{picker}{node}</>

  if (usesPicker && !game) return withPicker(null)

  // ── Loading the game → quiet centered popup ─────────────────────────────

  if (loadingGame) {
    return withPicker(
      <CenteredModal isOpen={open} onClose={closeBox} onExited={handleExited} ariaLabel="Loading game" maxWidth={360} steady>
        <div className="rnc-topbar">
          <button className="rnc-topbar-cancel" onClick={closeBox} type="button">
            Cancel
          </button>
          <span className="rnc-topbar-title">{isEditMode ? 'Edit review' : 'Write review'}</span>
          <span className="rnc-topbar-post rnc-topbar-post--disabled" aria-hidden="true">
            {isEditMode ? 'Save' : 'Post'}
          </span>
        </div>
        <div className="rnc-loading-body">
          <span className="rnc-inline-spinner" aria-label="Loading game…" />
        </div>
      </CenteredModal>
    )
  }

  // ── Game load error ──────────────────────────────────────────────────────

  if (gameError) {
    return withPicker(
      <CenteredModal isOpen={open} onClose={closeBox} onExited={handleExited} ariaLabel="Write review" maxWidth={360} steady>
        <div className="rnc-topbar">
          <button className="rnc-topbar-cancel" onClick={closeBox} type="button">
            Cancel
          </button>
          <span className="rnc-topbar-title">{isEditMode ? 'Edit review' : 'Write review'}</span>
          <span className="rnc-topbar-post rnc-topbar-post--disabled" aria-hidden="true">
            {isEditMode ? 'Save' : 'Post'}
          </span>
        </div>
        <div className="rnc-error-body">
          <p className="rnc-error-text">{gameError}</p>
        </div>
      </CenteredModal>
    )
  }

  // ── Composer ─────────────────────────────────────────────────────────────

  return withPicker(
    <>
    <CenteredModal
      isOpen={open}
      onClose={handleCancel}
      onExited={handleExited}
      ariaLabel={isEditMode ? 'Edit review' : 'Write review'}
      maxWidth={360}
      steady
    >
      {/* Top row: Cancel | Write review / Edit review | Post / Save */}
      <div className="rnc-topbar">
        <button className="rnc-topbar-cancel" onClick={handleCancel} type="button">
          Cancel
        </button>
        <span className="rnc-topbar-title">
          {isEditMode ? 'Edit review' : 'Write review'}
        </span>
        <button
          className={`rnc-topbar-post${!canSave ? ' rnc-topbar-post--disabled' : ''}`}
          onClick={handleSave}
          disabled={!canSave}
          type="button"
          aria-disabled={!canSave}
        >
          {submitting ? (
            <span className="rnc-post-spinner" aria-label={isEditMode ? 'Saving…' : 'Posting…'} />
          ) : (
            isEditMode ? 'Save' : 'Post'
          )}
        </button>
      </div>

      <div className="rnc-scroll cm-scroll">
        {/* Game header */}
        <div className="rnc-game-header">
          {coverSrc
            ? <img src={coverSrc} alt={game?.title} className="rnc-game-cover" />
            : <div className="rnc-game-cover rnc-game-cover--placeholder" aria-hidden="true" />
          }
          <div className="rnc-game-info">
            <p className="rnc-game-title">{game?.title}</p>
            {gameMeta && <p className="rnc-game-meta">{gameMeta}</p>}
          </div>
        </div>

        {/* ── PRIMARY: Star rating ─────────────────────────────────────── */}
        <div className="rnc-rating-block">
          <StarRatingInput
            value={rating}
            onChange={setRating}
            size="xl"
            aria-label="Your rating out of 5"
            className="rnc-stars"
          />
          <p className="rnc-rating-hint" aria-live="polite">
            {rating === 0 ? 'Tap to rate' : `${rating} out of 5`}
          </p>
        </div>

        {/* ── PRIMARY: Review text box ─────────────────────────────────── */}
        <div className="rnc-textarea-wrap">
          <textarea
            ref={textareaRef}
            className="rnc-textarea"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Write your thoughts…"
            maxLength={5000}
            aria-label="Review text"
          />
          <p className="rnc-char-count" aria-live="polite">{text.length}/5000</p>
        </div>

        {saveError && (
          <p className="form-field__error" role="alert">{saveError}</p>
        )}

        <p className="rnc-tip">
          Tip: use <em>*italics*</em> and <code>[spoiler]…[/spoiler]</code> for spoiler tags.
        </p>

        {/* ── Optional metadata — collapsed by default ─────────────────── */}
        <div className="rnc-details-section">
          <button
            type="button"
            className={`rnc-details-toggle${detailsOpen ? ' rnc-details-toggle--open' : ''}`}
            onClick={() => setDetailsOpen((v) => !v)}
            aria-expanded={detailsOpen}
          >
            <span>Add details</span>
            <span className="rnc-details-chevron" aria-hidden="true" />
          </button>

          {detailsOpen && (
            <div className="rnc-details-body">
              {/* Vibe stamps */}
              <div className="rnc-picker-section">
                <span className="rnc-picker-label">Vibe</span>
                <div className="rnc-stamp-row" role="group" aria-label="Vibe stamp">
                  {VIBE_STAMPS.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      className={`rnc-stamp-pill${vibeStamp === s.id ? ' rnc-stamp-pill--active' : ''}`}
                      onClick={() => setVibeStamp((prev) => (prev === s.id ? null : s.id))}
                      aria-pressed={vibeStamp === s.id}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Life context */}
              <div className="rnc-picker-section">
                <span className="rnc-picker-label">When in your life?</span>
                <div className="rnc-stamp-row" role="group" aria-label="Life context">
                  {LIFE_CONTEXTS.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      className={`rnc-stamp-pill${lifeContext === c.id ? ' rnc-stamp-pill--active' : ''}`}
                      onClick={() => setLifeContext((prev) => (prev === c.id ? null : c.id))}
                      aria-pressed={lifeContext === c.id}
                    >
                      {c.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Hours played */}
              <div className="rnc-hours-row">
                <span className="rnc-group-label">Hours played</span>
                <div className="rnc-stepper">
                  <button
                    type="button"
                    className="rnc-stepper-btn"
                    onClick={() => adjustHours(-0.5)}
                    aria-label="Decrease hours played"
                  >−</button>
                  <input
                    ref={hoursInputRef}
                    type="text"
                    inputMode="decimal"
                    className="rnc-stepper-input"
                    value={hoursRaw}
                    onChange={handleHoursChange}
                    onBlur={handleHoursBlur}
                    aria-label="Hours played"
                    maxLength={6}
                  />
                  <button
                    type="button"
                    className="rnc-stepper-btn"
                    onClick={() => adjustHours(0.5)}
                    aria-label="Increase hours played"
                  >+</button>
                </div>
              </div>

              {/* Writing prompts */}
              <div className="rnc-prompt-section">
                <span className="rnc-prompt-label">What stood out?</span>
                <div className="rnc-prompt-chips" role="group" aria-label="Writing prompt starters">
                  {PROMPT_CHIPS.map((chip) => (
                    <button
                      key={chip.id}
                      type="button"
                      className="rnc-prompt-chip"
                      onClick={() => handlePromptChip(chip.starter)}
                    >
                      {chip.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* ── Toggles ──────────────────────────────────────────────────── */}
        <div className="rnc-group" role="group" aria-label="Review options">
          <div className="rnc-group-row">
            <span className="rnc-group-label">Liked</span>
            <IOSSwitch
              checked={loved}
              onChange={setLoved}
              label="Mark as liked"
            />
          </div>

          <div className="rnc-group-divider" aria-hidden="true" />

          <div className="rnc-group-row">
            <span className="rnc-group-label">Contains spoilers</span>
            <IOSSwitch
              checked={containsSpoilers}
              onChange={setContainsSpoilers}
              label="Contains spoilers"
            />
          </div>

          {!isEditMode && (
            <>
              <div className="rnc-group-divider" aria-hidden="true" />
              <div className="rnc-group-row">
                <span className="rnc-group-label">Mark as completed</span>
                <IOSSwitch
                  checked={markCompleted}
                  onChange={setMarkCompleted}
                  label="Mark game as completed"
                />
              </div>
            </>
          )}
        </div>
      </div>
    </CenteredModal>
    {confirmSheet}
    </>
  )
}

export default ReviewComposer
