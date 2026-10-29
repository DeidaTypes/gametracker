import React, { forwardRef } from 'react'

const AuthBrand = forwardRef(function AuthBrand({ title, subtitle }, ref) {
  return (
    <div className="auth-brand">
      <img
        ref={ref}
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
