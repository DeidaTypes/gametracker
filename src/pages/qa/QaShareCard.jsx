import { createElement, forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import { createRoot } from 'react-dom/client'
import { coverUrlFromImageId } from '../../services/igdb'
import { buildQrDataUrl, CARD_HEIGHT, CARD_WIDTH, shareImageDataUrl } from '../../services/share'
import { siteLink } from '../../config/site'
import { displayNameFor } from './qaFormat'
// The frame (navy canvas, glow, footer with watermark + QR + link) and the
// cover / question / quote / byline styles all come from BrandedShareCard's
// own CSS, so this card is Navy under every app theme by construction. The
// file below only adds Q&A layout, in --share-* tokens.
import '../../components/BrandedShareCard.css'
import './QaShareCard.css'

export const SPOILER_LINE = 'Answer hidden \u2014 spoilers'
const MAX_ANSWER_CHARS = 360

/** First lines of an answer, cut at a word boundary. */
function answerExcerpt(body) {
  const text = String(body || '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim()
  if (text.length <= MAX_ANSWER_CHARS) return text
  const cut = text.slice(0, MAX_ANSWER_CHARS)
  const lastSpace = cut.lastIndexOf(' ')
  return `${(lastSpace > MAX_ANSWER_CHARS * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}\u2026`
}

/**
 * Everything the card shows, from the question payload already on screen.
 * Nothing is invented: a missing cover is a blank cover box, a missing name
 * is no byline, and a spoiler (answer or question) never gets its text drawn.
 */
export function buildQaShareData(question, answer) {
  const spoiler = !!(answer?.is_spoiler || question?.is_spoiler)
  const name = answer?.author_deleted ? null : displayNameFor(answer?.author)
  return {
    coverUrl: question?.game_cover_image_id
      ? coverUrlFromImageId(question.game_cover_image_id, 'cover_big')
      : null,
    gameTitle: question?.game_title || '',
    questionTitle: question?.title || '',
    answerText: spoiler ? null : answerExcerpt(answer?.body),
    spoiler,
    authorName: name,
  }
}

/**
 * QaShareCard — 1080x1350 offscreen capture target for a best answer.
 *
 * Same frame as BrandedShareCard (it uses its `bsc*` classes directly rather
 * than adding a Q&A variant there), so the footer's QR + short link appear
 * only when VITE_SITE_URL is set (`deepLinkUrl` / `qrDataUrl` are '' / null
 * otherwise).
 */
const QaShareCard = forwardRef(function QaShareCard(
  { data, deepLinkUrl = '', qrDataUrl = null, onReady },
  ref,
) {
  const rootRef = useRef(null)
  useImperativeHandle(ref, () => rootRef.current)

  useEffect(() => {
    if (typeof onReady !== 'function') return undefined
    const t = window.setTimeout(onReady, 120)
    return () => window.clearTimeout(t)
  }, [onReady])

  const shortUrl = deepLinkUrl.replace(/^https?:\/\//, '')
  const { coverUrl, gameTitle, questionTitle, answerText, spoiler, authorName } = data || {}

  return (
    <div ref={rootRef} className="bsc" aria-hidden="true">
      <div className="bsc__bg" />

      <div className="bsc__body">
        <div className="qsc">
          <p className="bsc-shelf__eyebrow qsc__eyebrow">Best answer on Checkpoint</p>

          <div className="bsc-quote__header qsc__header">
            {coverUrl ? (
              <img src={coverUrl} alt="" crossOrigin="anonymous" className="bsc-quote__cover" />
            ) : (
              <div className="bsc-quote__cover bsc-shelf__cover--fallback" />
            )}
            <div className="bsc-quote__game-info qsc__info">
              {gameTitle ? <p className="qsc__game">{gameTitle}</p> : null}
              <h2 className="bsc-quote__game-title qsc__question">{questionTitle}</h2>
            </div>
          </div>

          {spoiler ? (
            <p className="qsc__hidden">{SPOILER_LINE}</p>
          ) : answerText ? (
            <p className="bsc-quote__text qsc__answer">{answerText}</p>
          ) : null}

          {authorName ? <p className="bsc-quote__byline qsc__byline">&mdash; {authorName}</p> : null}
        </div>
      </div>

      <div className="bsc__footer">
        <span className="bsc__watermark">Checkpoint</span>
        <div className="bsc__qr-wrap">
          {qrDataUrl ? (
            <img src={qrDataUrl} alt="" crossOrigin="anonymous" className="bsc__qr" />
          ) : null}
          <span className="bsc__url">{shortUrl}</span>
        </div>
      </div>
    </div>
  )
})

export default QaShareCard

/**
 * Render the card offscreen, capture it as a PNG, and run the app's normal
 * share cascade (Web Share with file -> Capacitor Share -> download). The
 * link is the question's landing page and exists only when SITE_URL is set.
 *
 * @returns {Promise<{ method: string, dataUrl: string }>}
 */
export async function shareQaBestAnswer(question, answer) {
  const { toPng } = await import('html-to-image')
  const data = buildQaShareData(question, answer)
  const deepLinkUrl = siteLink('question', question?.id, { title: question?.title })
  const qrDataUrl = deepLinkUrl ? await buildQrDataUrl(deepLinkUrl) : null

  const host = document.createElement('div')
  host.style.cssText = [
    'position:fixed',
    'left:-9999px',
    'top:-9999px',
    `width:${CARD_WIDTH}px`,
    `height:${CARD_HEIGHT}px`,
    'pointer-events:none',
    'z-index:-1',
    'overflow:hidden',
  ].join(';')
  document.body.appendChild(host)

  const root = createRoot(host)
  let dataUrl = null
  try {
    await new Promise((resolve) => {
      root.render(createElement(QaShareCard, { data, deepLinkUrl, qrDataUrl, onReady: resolve }))
    })
    // The cover must be decoded before the capture, or the card exports with
    // an empty cover box.
    await Promise.all(
      Array.from(host.querySelectorAll('img')).map((img) =>
        typeof img.decode === 'function' ? img.decode().catch(() => {}) : Promise.resolve(),
      ),
    )
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
    dataUrl = await toPng(host.firstElementChild, { cacheBust: true, pixelRatio: 1 })
  } finally {
    root.unmount()
    document.body.removeChild(host)
  }

  const result = await shareImageDataUrl(dataUrl, {
    title: question?.title || 'Best answer on Checkpoint',
    url: deepLinkUrl,
    filename: 'checkpoint-best-answer.png',
  })
  return { ...result, dataUrl }
}
