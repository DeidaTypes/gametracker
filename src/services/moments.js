import { Capacitor } from '@capacitor/core'

/**
 * Payoff haptics. Each call is a no-op on web / when the native plugin
 * is missing — try/catch plus an explicit Capacitor.isNativePlatform()
 * gate so the web build never logs.
 */
async function withNativeHaptics(run) {
  try {
    if (!Capacitor.isNativePlatform()) return
    const { Haptics, ImpactStyle, NotificationType } = await import('@capacitor/haptics')
    await run({ Haptics, ImpactStyle, NotificationType })
  } catch {
    /* no-op on web or when the plugin isn't available */
  }
}

export async function tap() {
  await withNativeHaptics(({ Haptics, ImpactStyle }) =>
    Haptics.impact({ style: ImpactStyle.Light })
  )
}

export async function add() {
  await withNativeHaptics(({ Haptics, ImpactStyle }) =>
    Haptics.impact({ style: ImpactStyle.Medium })
  )
}

export async function success() {
  await withNativeHaptics(({ Haptics, NotificationType }) =>
    Haptics.notification({ type: NotificationType.Success })
  )
}
