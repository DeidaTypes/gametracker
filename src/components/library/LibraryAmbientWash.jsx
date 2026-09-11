import React from 'react'

export default function LibraryAmbientWash({ isGamesTab }) {
  return (
    <>
      <div
        className={`lib-ambient-wash lib-ambient-wash--games${isGamesTab ? ' lib-ambient-wash--on' : ''}`}
        aria-hidden="true"
      />
      <div
        className={`lib-ambient-wash lib-ambient-wash--lists${!isGamesTab ? ' lib-ambient-wash--on' : ''}`}
        aria-hidden="true"
      />
    </>
  )
}
