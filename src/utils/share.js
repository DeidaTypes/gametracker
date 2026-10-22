/**
 * Share text and, when there is one, a link.
 *
 * `url` is optional: when the site is not configured (src/config/site.js) the
 * callers have no link to offer, and the share goes out as text only.
 *
 * Resolves with { method, copied? }. `copied` is set when the clipboard
 * fallback ran: 'link' if a URL was copied, 'text' if only text was.
 */
export async function shareContent({ title, text, url, dialogTitle = 'Share' }) {
  // Only include fields that have a value — share sheets reject empty strings.
  const payload = {}
  if (title) payload.title = title
  if (text) payload.text = text
  if (url) payload.url = url

  // 1. Try Capacitor Share plugin (native iOS share sheet)
  try {
    const { Share } = await import('@capacitor/share');
    const canShare = await Share.canShare();
    if (canShare?.value) {
      await Share.share({ ...payload, dialogTitle });
      return { method: 'capacitor' };
    }
  } catch (e) { /* plugin missing or unavailable, fall through */ }

  // 2. Try Web Share API
  if (typeof navigator !== 'undefined' && navigator.share) {
    try {
      await navigator.share(payload);
      return { method: 'web-share' };
    } catch (e) {
      if (e.name === 'AbortError') return { method: 'aborted' };
    }
  }

  // 3. Fall back to clipboard
  const clipboardText = url || text || title || '';
  if (!clipboardText) return { method: 'failed' };
  try {
    await navigator.clipboard.writeText(clipboardText);
    if (typeof window !== 'undefined' && window.gtToast) {
      window.gtToast(url ? 'Link copied' : 'Copied');
    }
    return { method: 'clipboard', copied: url ? 'link' : 'text' };
  } catch (e) {
    return { method: 'failed', error: e };
  }
}
