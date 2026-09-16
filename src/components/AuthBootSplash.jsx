/**
 * Boot splash shown only while we're restoring the Supabase session on
 * initial page load. Matches the native LaunchScreen (mascot centered on
 * --bg-base at 260pt) so the handoff from iOS launch → WebView is invisible.
 */
export default function AuthBootSplash() {
  return (
    <div className="auth-boot" role="status" aria-label="Loading">
      <img
        className="auth-boot__mascot"
        src="/brand/checkpoint-splash-1x.png"
        srcSet="/brand/checkpoint-splash-1x.png 1x, /brand/checkpoint-splash-2x.png 2x, /brand/checkpoint-splash-3x.png 3x"
        width={157}
        height={260}
        alt=""
        aria-hidden="true"
        draggable={false}
      />
    </div>
  )
}
