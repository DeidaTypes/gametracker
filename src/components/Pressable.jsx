import { forwardRef, useMemo } from 'react'
import { motion } from 'motion/react'
import { useMotionPreference } from '../hooks/useMotionPreference'

/**
 * Universal tap-feedback wrapper. Renders a motion-enabled element
 * (default <button>) that scales to 0.97 on press and back to 1 on
 * release. Honors prefers-reduced-motion via useMotionPreference —
 * when reduced motion is requested the press animation is skipped
 * entirely so the element behaves like a plain DOM node.
 *
 * Prefer Pressable over bare <button>/<div role="button"> anywhere
 * the user taps to invoke an action (cards, list rows, icon buttons,
 * sheet items). Form-control children inside <form> can keep using
 * bare <button> when the surrounding form submit handling matters.
 *
 * Props:
 *   as          – DOM tag to render. Defaults to 'button'. Use 'div'
 *                 or 'a' for non-button surfaces.
 *   type        – button type attribute (only applied when as==='button').
 *                 Defaults to 'button' so forms aren't accidentally
 *                 submitted.
 *   className   – passthrough class string.
 *   disabled    – when true, skips the press animation and applies the
 *                 DOM disabled attribute when as==='button'.
 *   children    – content rendered inside the element.
 *   Other props (onClick, aria-*, etc.) are forwarded to the underlying
 *   motion element.
 */
const TAP_TRANSITION = { duration: 0.12, ease: [0.22, 0.61, 0.36, 1] }

const Pressable = forwardRef(function Pressable(
  {
    as = 'button',
    type,
    className,
    disabled,
    children,
    style,
    whileHover,
    whileTap,
    transition,
    ...rest
  },
  ref,
) {
  const { reduced } = useMotionPreference()

  const Component = useMemo(() => motion[as] ?? motion.button, [as])

  const resolvedTap = reduced || disabled ? undefined : (whileTap ?? { scale: 0.97 })
  const resolvedTransition = transition ?? TAP_TRANSITION

  const buttonProps =
    as === 'button'
      ? { type: type ?? 'button', disabled: !!disabled }
      : {}

  return (
    <Component
      ref={ref}
      className={className}
      style={style}
      whileTap={resolvedTap}
      whileHover={reduced ? undefined : whileHover}
      transition={resolvedTransition}
      {...buttonProps}
      {...rest}
    >
      {children}
    </Component>
  )
})

export default Pressable
