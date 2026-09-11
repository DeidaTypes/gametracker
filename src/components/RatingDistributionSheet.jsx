import React, { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'motion/react'
import { useMotionPreference } from '../hooks/useMotionPreference'
import CommunityRatingCard from './CommunityRatingCard'
import './RatingDistributionSheet.css'

/**
 * Thin bottom sheet that surfaces the existing CommunityRatingCard histogram.
 * No dedicated distribution sheet existed before this wrapper — internals are
 * CommunityRatingCard unchanged (true half-star buckets, not ridge rounding).
 */
export default function RatingDistributionSheet({ isOpen, onClose, ratingDist }) {
  const sheetRef = useRef(null)
  const { reduced } = useMotionPreference()

  const totalCount = ratingDist?.totalCount ?? 0
  const hasRatings = totalCount > 0 && ratingDist?.average != null && !ratingDist?.error

  useEffect(() => {
    if (!isOpen) return
    const el = sheetRef.current
    if (!el) return
    const id = setTimeout(() => el.focus(), 50)
    return () => clearTimeout(id)
  }, [isOpen])

  useEffect(() => {
    if (!isOpen) return
    const handleKey = (e) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [isOpen, onClose])

  const backdropTransition = reduced ? { duration: 0 } : { duration: 0.15 }
  const sheetTransition = reduced
    ? { duration: 0 }
    : { type: 'spring', stiffness: 380, damping: 32 }

  return createPortal(
    <AnimatePresence>
      {isOpen && (
        <motion.div
          className="rating-dist-sheet-overlay"
          onClick={onClose}
          aria-modal="true"
          role="dialog"
          aria-label="Community rating distribution"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={backdropTransition}
        >
          <motion.div
            ref={sheetRef}
            className="rating-dist-sheet"
            tabIndex={-1}
            onClick={(e) => e.stopPropagation()}
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={sheetTransition}
          >
            <div className="rating-dist-sheet__handle" aria-hidden="true" />
            <h2 className="rating-dist-sheet__title">Community ratings</h2>

            {hasRatings ? (
              <>
                <CommunityRatingCard
                  average={ratingDist.average}
                  totalCount={ratingDist.totalCount}
                  counts={ratingDist.counts}
                />
                <p className="rating-dist-sheet__caption">
                  The ridge on Game Detail groups half ratings into the star above.
                  This chart shows the true half-star distribution.
                </p>
              </>
            ) : (
              <p className="rating-dist-sheet__empty">No community ratings yet.</p>
            )}

            <button type="button" className="rating-dist-sheet__close" onClick={onClose}>
              Close
            </button>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  )
}
