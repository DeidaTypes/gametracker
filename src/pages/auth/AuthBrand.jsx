import React, { forwardRef, useCallback, useLayoutEffect, useRef } from 'react'
import { handOffBootSplash, isBootSplashActive } from '../../motion/bootSplash'

const AuthBrand = forwardRef(function AuthBrand({ title, subtitle }, forwardedRef) {
  const imgRef = useRef(null)

  const setRef = useCallback(
    (el) => {
      imgRef.current = el
      if (typeof forwardedRef === 'function') forwardedRef(el)
      else if (forwardedRef) forwardedRef.current = el
    },
    [forwardedRef],
  )

  // Opening the app on a sign-in screen: the splash mascot glides into this
  // one while the page fades in around it (src/motion/bootSplash.js). The page
  // is held at opacity 0 until the glide starts, so nothing shows before it.
  // After the first hand-off, or with no splash up, this does nothing.
  useLayoutEffect(() => {
    const img = imgRef.current
    if (!img) return
    if (isBootSplashActive()) {
      img.closest('.auth-page')?.classList.add('auth-page--hold')
    }
    handOffBootSplash({ target: img })
  }, [])

  return (
    <div className="auth-brand">
      <img
        ref={setRef}
        className="auth-mascot"
        data-boot-target
        src="/brand/checkpoint-splash-1x.png"
        srcSet="/brand/checkpoint-splash-1x.png 1x, /brand/checkpoint-splash-2x.png 2x, /brand/checkpoint-splash-3x.png 3x"
        width={51}
        height={84}
        alt=""
        aria-hidden="true"
        draggable={false}
      />
      <h1 className="auth-title">{title}</h1>
      {subtitle ? <p className="auth-subtitle">{subtitle}</p> : null}
    </div>
  )
})

export default AuthBrand
