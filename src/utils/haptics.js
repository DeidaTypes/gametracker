// Capacitor Haptics — the one shared integration for haptic feedback
// app-wide. Dynamic import + try/catch so the web build (and any
// environment without the native plugin) is a silent no-op. This is the
// pattern that originated on ListDetail's drag-to-reorder / BottomNav's
// tab taps; every haptic call site in the app should go through here
// instead of re-implementing the dynamic import locally.
//
// The haptic language (one table, app-wide). Fire from the shared component
// when one exists (IOSSwitch, StarRatingInput, SettingsRows, LibraryTabs,
// ConfirmSheet...) so every screen inherits it, and never fire two haptics
// for one action.
//   - Light   -> selecting a tab/segment (only when it changes), choosing a
//                status, tapping a star, toggling a switch, choosing a chip,
//                opening the + FAB, follow/unfollow, like, add to list,
//                revealing a spoiler, swipe card commit, pull-to-refresh.
//   - Success -> saving a review, journal entry, session log or list;
//                marking a game Played; finishing a challenge goal; posting a
//                comment, question, answer or message; mark as best.
//   - Medium  -> delete, remove, block, report sent, sign out.
//   - None    -> scrolling, opening screens, typing, re-tapping the selected
//                option.
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

export const hapticLight = () => hapticImpact('Light')
export const hapticMedium = () => hapticImpact('Medium')
