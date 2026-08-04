// Capacitor Haptics — the one shared integration for haptic feedback
// app-wide. Dynamic import + try/catch so the web build (and any
// environment without the native plugin) is a silent no-op. This is the
// pattern that originated on ListDetail's drag-to-reorder / BottomNav's
// tab taps; every haptic call site in the app should go through here
// instead of re-implementing the dynamic import locally.
//
// Intensity guidance (see .cursorrules "Sprint 5" / haptics polish pass):
//   - Light  → toggles and low-stakes taps (like, follow, nav tab, switch)
//   - Medium → confirmations that commit something (status change, save,
//              submit)
//   - Success notification → celebratory, one-shot moments (goal reached,
//              badge/milestone unlocked)
// Never fire Heavy — this app's haptics read as polish, not buzzing.

export async function hapticImpact(style = 'Light') {
  try {
    const { Haptics, ImpactStyle } = await import('@capacitor/haptics')
    await Haptics.impact({ style: ImpactStyle[style] })
  } catch {
    /* no-op on web or when the plugin isn't available */
  }
}

export async function hapticSuccess() {
  try {
    const { Haptics, NotificationType } = await import('@capacitor/haptics')
    await Haptics.notification({ type: NotificationType.Success })
  } catch {
    /* no-op on web or when the plugin isn't available */
  }
}
