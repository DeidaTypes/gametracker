import { Capacitor } from '@capacitor/core'
import packageJson from '../../package.json'

const APP_NAME = 'Checkpoint'
export const APP_VERSION = packageJson.version || '0.0.0'
export const APP_BUILD = import.meta.env.VITE_BUILD_NUMBER || '1'

/**
 * Device/OS facts for the feedback diagnostic block. Native-only —
 * @capacitor/device has no meaningful equivalent on web, so dev/web
 * builds report 'web' rather than guessing from the user agent.
 */
async function getDeviceDiagnostics() {
  if (!Capacitor.isNativePlatform()) {
    return { osVersion: 'web', deviceModel: 'web' }
  }
  try {
    const { Device } = await import('@capacitor/device')
    const info = await Device.getInfo()
    return {
      osVersion: info.osVersion || 'unknown',
      deviceModel: info.model || 'unknown',
    }
  } catch {
    return { osVersion: 'unknown', deviceModel: 'unknown' }
  }
}

/**
 * Builds the diagnostic block appended to feedback emails. Deliberately
 * limited to app/build/OS/device + the user's id — no email or other
 * personal data, per the privacy constraint on this feature.
 */
export async function buildFeedbackDiagnostics(userId) {
  const { osVersion, deviceModel } = await getDeviceDiagnostics()
  return [
    '--- Diagnostics (please leave this in place) ---',
    `App version: ${APP_VERSION} (build ${APP_BUILD})`,
    `iOS version: ${osVersion}`,
    `Device model: ${deviceModel}`,
    `User ID: ${userId || 'not signed in'}`,
  ].join('\n')
}

/**
 * Builds a `mailto:` URL to the support address with a subject that
 * identifies the app/build and a body pre-filled with the diagnostic
 * block above a couple of blank lines for the user's message.
 */
export async function buildFeedbackMailto(email, userId) {
  const diagnostics = await buildFeedbackDiagnostics(userId)
  const subject = `${APP_NAME} Feedback (v${APP_VERSION}, build ${APP_BUILD})`
  const body = `\n\n\n${diagnostics}`
  return `mailto:${email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
}
