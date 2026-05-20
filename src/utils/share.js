export async function shareContent({ title, text, url }) {
  // 1. Try Capacitor Share plugin (native iOS share sheet)
  try {
    const { Share } = await import('@capacitor/share');
    const canShare = await Share.canShare();
    if (canShare?.value) {
      await Share.share({ title, text, url, dialogTitle: 'Share' });
      return { method: 'capacitor' };
    }
  } catch (e) { /* plugin missing or unavailable, fall through */ }

  // 2. Try Web Share API
  if (typeof navigator !== 'undefined' && navigator.share) {
    try {
      await navigator.share({ title, text, url });
      return { method: 'web-share' };
    } catch (e) {
      if (e.name === 'AbortError') return { method: 'aborted' };
    }
  }

  // 3. Fall back to clipboard
  try {
    await navigator.clipboard.writeText(url);
    if (typeof window !== 'undefined' && window.gtToast) {
      window.gtToast('Link copied');
    }
    return { method: 'clipboard' };
  } catch (e) {
    return { method: 'failed', error: e };
  }
}
