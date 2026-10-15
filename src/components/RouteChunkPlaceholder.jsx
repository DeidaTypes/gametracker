import './RouteChunkPlaceholder.css'

/**
 * Suspense fallback for a pushed route whose chunk is not ready yet.
 * Sized to the screen so the X slide has a full page to move, using the
 * same skeleton treatment pages reserve while their data is in flight.
 * Never a spinner.
 */
export default function RouteChunkPlaceholder() {
  return (
    <div
      className="route-chunk-placeholder"
      role="status"
      aria-live="polite"
      aria-busy="true"
      aria-label="Loading"
    >
      <div className="route-chunk-placeholder__mark skeleton" />
      <div className="route-chunk-placeholder__title skeleton" />
      <div className="route-chunk-placeholder__line skeleton" />
      <div className="route-chunk-placeholder__line skeleton" />
      <div className="route-chunk-placeholder__line route-chunk-placeholder__line--short skeleton" />
    </div>
  )
}
