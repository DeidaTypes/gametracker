import { motion } from 'motion/react'
import { useNavigationType } from 'react-router-dom'
import { useMotionPreference } from '../hooks/useMotionPreference'

/**
 * Wraps a top-level page component with a subtle fade + 8 px slide when
 * it enters. No exit animation is used because AnimatePresence deadlocks
 * with LayoutGroup when layoutId descendants are present (Motion bug
 * #3059). The enter-only animation is intentional: the old page unmounts
 * cleanly and the new page fades/slides in, which looks polished while
 * keeping SharedCover FLIP transitions working correctly.
 *
 * Direction:
 *   - PUSH    (forward nav): enters from right (+8 px)
 *   - POP     (back nav):    enters from left  (-8 px)
 *   - REPLACE: treated as forward
 *
 * Reduced-motion: x offset is zeroed; fade runs at 120 ms (vs 220 ms).
 * The global _motion.css fallback also kills all transitions at OS level.
 */
export default function PageTransition({ children }) {
  const navType = useNavigationType()
  const { reduced, fadeOnly } = useMotionPreference()

  const isBack = navType === 'POP'

  // 8 px slide. Zero when reduced-motion is active — fade does the work.
  const xIn = reduced ? 0 : isBack ? -8 : 8

  return (
    <motion.div
      className="page-transition"
      initial={{ opacity: 0, x: xIn }}
      animate={{ opacity: 1, x: 0 }}
      transition={fadeOnly}
    >
      {children}
    </motion.div>
  )
}
