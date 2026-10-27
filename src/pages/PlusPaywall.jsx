import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Navigate, useNavigate } from 'react-router-dom'
import { AnimatePresence, motion } from 'motion/react'
import { useMotionPreference } from '../hooks/useMotionPreference'
import {
  LuChartNoAxesColumn,
  LuChevronLeft,
  LuCircleUser,
  LuDownload,
  LuMegaphoneOff,
  LuStar,
  LuCheck,
} from 'react-icons/lu'
import { useAuth } from '../contexts/AuthContext'
import PlusBadge from '../components/PlusBadge'
import { showToast } from '../components/Toast'
import { PRIVACY_URL, TERMS_URL } from '../config/site'
import {
  PLUS_CONFIG,
  PLUS_PURCHASES_AVAILABLE,
  getOfferings,
  purchase,
  restore,
} from '../services/plusService'
import { hapticImpact, hapticSuccess } from '../utils/haptics'
import './PlusPaywall.css'

const IS_SUBSCRIPTION = PLUS_CONFIG.productModel === 'subscription'

/** Everything Plus needs to exist in this build: RevenueCat key + legal links. */
const PAYWALL_AVAILABLE = PLUS_PURCHASES_AVAILABLE && Boolean(TERMS_URL && PRIVACY_URL)

const PERKS = [
  {
    id: 'ads',
    icon: LuMegaphoneOff,
    title: 'No ads',
    description: 'The banner above the nav is gone.',
  },
  {
    id: 'badge',
    icon: LuCircleUser,
    title: 'Plus badge',
    description: 'Next to your name on your profile, reviews and comments.',
  },
  {
    id: 'export',
    icon: LuDownload,
    title: 'Export your data',
    description: 'Your library, reviews, journal and lists as JSON and CSV.',
  },
  {
    id: 'stats',
    icon: LuChartNoAxesColumn,
    title: 'Advanced stats',
    description: 'The deeper breakdowns in Stats.',
  },
]

const PERIOD_LABEL = { yearly: 'per year', monthly: 'per month' }

function openExternal(event, url) {
  event.preventDefault()
  try {
    window.open(url, '_blank', 'noopener,noreferrer')
  } catch {
    window.location.href = url
  }
}

function formatMoney(amount, currency) {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(amount)
  } catch {
    return null
  }
}

function priceOf(pkg) {
  const price = Number(pkg?.product?.price)
  return Number.isFinite(price) && price > 0 ? price : null
}

/** In-app back; a deep link has no prior entry, so fall back to Settings. */
function goBack(navigate) {
  const idx = window.history.state?.idx
  if (typeof idx === 'number' && idx > 0) navigate(-1)
  else navigate('/settings', { replace: true })
}

function Spinner() {
  return <span className="plus-paywall__spin" aria-hidden="true" />
}

function SuccessCard({ open, name, onDone }) {
  // OS setting AND the in-app Reduce motion switch.
  const { reduced } = useMotionPreference()
  const doneRef = useRef(null)

  useEffect(() => {
    if (!open) return undefined
    hapticSuccess()
    const id = setTimeout(() => doneRef.current?.focus(), 60)
    return () => clearTimeout(id)
  }, [open])

  const overlay = reduced
    ? { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 }, transition: { duration: 0.12 } }
    : { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 }, transition: { duration: 0.18 } }
  const card = reduced
    ? {}
    : {
        initial: { scale: 0.96 },
        animate: { scale: 1 },
        transition: { duration: 0.18, ease: [0.2, 0.8, 0.2, 1] },
      }

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          className="plus-paywall__success"
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="plus-success-title"
          {...overlay}
        >
          <motion.div className="plus-paywall__success-card" {...card}>
            <div className="plus-paywall__success-ok" aria-hidden="true">
              <LuCheck size={26} strokeWidth={2.2} />
            </div>
            <h2 id="plus-success-title" className="plus-paywall__success-title text-heading">
              You&rsquo;re Plus
            </h2>
            <p className="plus-paywall__success-copy text-body">
              Thanks for supporting Checkpoint. Ads are gone and your badge is live.
            </p>
            {name ? (
              <div className="plus-paywall__success-name text-body">
                <span>{name}</span>
                <PlusBadge active />
              </div>
            ) : null}
            <button
              ref={doneRef}
              type="button"
              className="plus-paywall__cta plus-paywall__cta--in-card"
              onClick={onDone}
            >
              Done
            </button>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  )
}

function PaywallScreen() {
  const navigate = useNavigate()
  const { profile, plusFinishing } = useAuth()

  const [offerings, setOfferings] = useState({ status: 'loading', monthly: null, yearly: null })
  const [attempt, setAttempt] = useState(0)
  const [selected, setSelected] = useState('yearly')
  const [busy, setBusy] = useState(null) // 'purchase' | 'restore' | null
  const [errorText, setErrorText] = useState('')
  const [celebrating, setCelebrating] = useState(false)

  useEffect(() => {
    let cancelled = false
    setOfferings({ status: 'loading', monthly: null, yearly: null })
    getOfferings()
      .then(({ monthly, yearly }) => {
        if (cancelled) return
        if (!monthly && !yearly) {
          setOfferings({ status: 'error', monthly: null, yearly: null })
          return
        }
        setOfferings({ status: 'ready', monthly, yearly })
        setSelected((prev) => (prev === 'yearly' && !yearly ? 'monthly' : prev === 'monthly' && !monthly ? 'yearly' : prev))
      })
      .catch((err) => {
        if (cancelled) return
        console.warn('[plus] offerings failed:', err?.message || err)
        setOfferings({ status: 'error', monthly: null, yearly: null })
      })
    return () => {
      cancelled = true
    }
  }, [attempt])

  const { monthly, yearly } = offerings
  const isReady = offerings.status === 'ready'
  const working = busy !== null || plusFinishing

  const savePercent = useMemo(() => {
    const m = priceOf(monthly)
    const y = priceOf(yearly)
    if (!m || !y) return null
    const pct = Math.round((1 - y / (m * 12)) * 100)
    return pct >= 1 && pct < 100 ? pct : null
  }, [monthly, yearly])

  const yearlyPerMonth = useMemo(() => {
    const y = priceOf(yearly)
    const currency = yearly?.product?.currencyCode
    if (!y || !currency) return null
    return formatMoney(y / 12, currency)
  }, [yearly])

  const plans = useMemo(() => {
    const list = []
    if (yearly) {
      list.push({
        id: 'yearly',
        pkg: yearly,
        name: 'Yearly',
        meta: yearlyPerMonth ? `${yearlyPerMonth} a month, billed yearly` : 'Billed yearly',
        chip: savePercent ? `Save ${savePercent}%` : null,
      })
    }
    if (monthly) {
      list.push({ id: 'monthly', pkg: monthly, name: 'Monthly', meta: 'Billed monthly', chip: null })
    }
    return list
  }, [yearly, monthly, yearlyPerMonth, savePercent])

  const selectedPlan = plans.find((p) => p.id === selected) || plans[0] || null

  const finish = useCallback((status) => {
    if (status === 'active') {
      setCelebrating(true)
    } else if (status === 'pending') {
      showToast('Purchase found. Plus will show up in a moment.', 'success')
    }
  }, [])

  const handleBuy = async () => {
    if (!selectedPlan || working) return
    hapticImpact('Medium')
    setErrorText('')
    setBusy('purchase')
    try {
      const { status } = await purchase(selectedPlan.pkg)
      if (status !== 'cancelled') finish(status)
    } catch (err) {
      console.warn('[plus] purchase failed:', err?.message || err)
      setErrorText('The purchase didn\u2019t go through. You weren\u2019t charged.')
    } finally {
      setBusy(null)
    }
  }

  const handleRestore = async () => {
    if (working) return
    hapticImpact('Light')
    setErrorText('')
    setBusy('restore')
    try {
      const { status } = await restore()
      if (status === 'none') {
        showToast('No Checkpoint Plus purchase found for this Apple ID.', 'error')
      } else {
        finish(status)
      }
    } catch (err) {
      console.warn('[plus] restore failed:', err?.message || err)
      setErrorText('Couldn\u2019t restore purchases. Try again.')
    } finally {
      setBusy(null)
    }
  }

  const displayName = profile?.display_name || profile?.username || ''

  const ctaContent = plusFinishing ? (
    <>
      <Spinner />
      Finishing up&hellip;
    </>
  ) : busy === 'purchase' ? (
    <>
      <Spinner />
      <span className="plus-paywall__sr">Purchasing</span>
    </>
  ) : (
    'Continue'
  )

  return (
    <div className="plus-paywall">
      <header className="plus-paywall__top">
        <button
          type="button"
          className="plus-paywall__back"
          onClick={() => goBack(navigate)}
          aria-label="Go back"
        >
          <LuChevronLeft size={22} strokeWidth={1.6} aria-hidden="true" />
        </button>
      </header>

      <div className="plus-paywall__scroll">
        <section className="plus-paywall__hero">
          <div className="plus-paywall__wash" aria-hidden="true" />
          <div className="plus-paywall__mark" aria-hidden="true">
            <LuStar size={26} strokeWidth={1.8} />
          </div>
          <h1 className="plus-paywall__title text-display-l">Checkpoint Plus</h1>
          <p className="plus-paywall__lede text-body">
            Support an indie app and get a cleaner, deeper Checkpoint.
          </p>
        </section>

        <ul className="plus-paywall__perks">
          {PERKS.map(({ id, icon: Icon, title, description }) => (
            <li key={id} className="plus-paywall__perk">
              <Icon className="plus-paywall__perk-icon" size={22} strokeWidth={1.8} aria-hidden="true" />
              <div>
                <p className="plus-paywall__perk-title text-body">{title}</p>
                <p className="plus-paywall__perk-desc text-caption">{description}</p>
              </div>
            </li>
          ))}
        </ul>

        <h2 className="plus-paywall__section text-label">Choose a plan</h2>

        {offerings.status === 'loading' && (
          <div role="status" aria-label="Loading prices">
            {[0, 1].map((i) => (
              <div key={i} className="plus-paywall__plan plus-paywall__plan--skeleton" aria-hidden="true">
                <span className="plus-paywall__radio" />
                <div className="plus-paywall__skeleton-lines">
                  <div className="skeleton plus-paywall__skeleton-line plus-paywall__skeleton-line--title" />
                  <div className="skeleton plus-paywall__skeleton-line plus-paywall__skeleton-line--meta" />
                </div>
              </div>
            ))}
          </div>
        )}

        {offerings.status === 'error' && (
          <div className="plus-paywall__empty">
            <p className="plus-paywall__empty-title text-body">Can&rsquo;t load prices</p>
            <p className="plus-paywall__empty-desc text-caption">
              Check your connection and try again.
            </p>
            <button
              type="button"
              className="plus-paywall__ghost"
              onClick={() => setAttempt((n) => n + 1)}
            >
              Try again
            </button>
          </div>
        )}

        {isReady && (
          <div role="radiogroup" aria-label="Plan">
            {plans.map((plan) => {
              const on = plan.id === selectedPlan?.id
              return (
                <button
                  key={plan.id}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  disabled={working}
                  className={`plus-paywall__plan${on ? ' plus-paywall__plan--on' : ''}`}
                  onClick={() => {
                    if (!on) hapticImpact('Light')
                    setSelected(plan.id)
                  }}
                >
                  <span className="plus-paywall__radio" aria-hidden="true" />
                  <span className="plus-paywall__plan-main">
                    <span className="plus-paywall__plan-name text-body">
                      {plan.name}
                      {plan.chip && <span className="plus-paywall__save text-label">{plan.chip}</span>}
                    </span>
                    <span className="plus-paywall__plan-meta text-caption">{plan.meta}</span>
                  </span>
                  <span className="plus-paywall__plan-price">
                    <span className="plus-paywall__plan-amount text-body">{plan.pkg.product.priceString}</span>
                    <span className="plus-paywall__plan-period text-caption">{PERIOD_LABEL[plan.id]}</span>
                  </span>
                </button>
              )
            })}
          </div>
        )}

        {offerings.status !== 'error' && (
          <button
            type="button"
            className="plus-paywall__cta"
            disabled={!isReady || working}
            aria-busy={working || undefined}
            onClick={handleBuy}
          >
            {ctaContent}
          </button>
        )}

        {errorText && (
          <p className="plus-paywall__error text-caption" role="alert">
            {errorText}
          </p>
        )}

        <button
          type="button"
          className="plus-paywall__link text-body"
          disabled={working}
          onClick={handleRestore}
        >
          {busy === 'restore' ? 'Restoring\u2026' : 'Restore purchases'}
        </button>

        {isReady && selectedPlan && (
          <p className="plus-paywall__legal text-caption">
            {IS_SUBSCRIPTION && (
              <>
                {selectedPlan.pkg.product.priceString} {PERIOD_LABEL[selectedPlan.id]}. Renews
                automatically until cancelled. Cancel anytime in Settings &rsaquo; Apple ID &rsaquo;
                Subscriptions at least 24 hours before renewal.{' '}
              </>
            )}
            <a href={TERMS_URL} onClick={(e) => openExternal(e, TERMS_URL)}>
              Terms
            </a>
            {' \u00b7 '}
            <a href={PRIVACY_URL} onClick={(e) => openExternal(e, PRIVACY_URL)}>
              Privacy
            </a>
          </p>
        )}
      </div>

      <SuccessCard
        open={celebrating}
        name={displayName}
        onDone={() => {
          setCelebrating(false)
          goBack(navigate)
        }}
      />
    </div>
  )
}

/**
 * Checkpoint Plus paywall — a pushed full screen at /plus.
 * Without the RevenueCat key or the Terms / Privacy links there is nothing to
 * show, so the route sends the user back to Settings. Someone who is already
 * Plus when they arrive is sent there too; the check is made once on entry so
 * a purchase finishing on this screen still gets its success card.
 */
export default function PlusPaywall() {
  const { plusActive } = useAuth()
  const alreadyPlus = useRef(plusActive)

  if (!PAYWALL_AVAILABLE || alreadyPlus.current) {
    return <Navigate to="/settings" replace />
  }
  return <PaywallScreen />
}
