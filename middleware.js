/**
 * Vercel Edge Middleware — OG / social crawler routing.
 *
 * When a social crawler (Facebook, Twitter/X, Slack, iMessage, Discord,
 * WhatsApp, Telegram, LinkedIn, Google, Bing, Apple …) requests a content
 * URL, it receives the SPA's generic index.html which has no per-page OG
 * meta — producing a bare URL preview instead of a rich card.
 *
 * This middleware intercepts content path requests, detects crawler
 * User-Agents, and transparently proxies to /api/og?path=<path> which
 * returns a fully-tagged HTML page. Regular browser traffic passes through
 * unchanged and is served the SPA as normal.
 *
 * Matches: /game/*, /review/*, /reviews/*, /user/*, /list/*
 */

const CRAWLER_RE =
  /facebookexternalhit|facebot|twitterbot|slackbot|telegrambot|whatsapp|linkedinbot|discordbot|googlebot|bingbot|applebot|embedly|quora link preview|rogerbot|vkshare|w3c_validator|redditbot|ia_archiver|msnbot/i

export default async function middleware(request) {
  const ua = request.headers.get('user-agent') || ''
  if (!CRAWLER_RE.test(ua)) return // pass through for real browsers

  const { origin, pathname } = new URL(request.url)
  const ogUrl = new URL(`${origin}/api/og`)
  ogUrl.searchParams.set('path', pathname)

  // Transparent proxy — the browser URL stays on the original path while
  // crawlers see the OG-tagged HTML.
  try {
    const ogResponse = await fetch(ogUrl.toString())
    return new Response(ogResponse.body, {
      status: ogResponse.status,
      headers: {
        'Content-Type': ogResponse.headers.get('Content-Type') || 'text/html; charset=utf-8',
        'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600',
      },
    })
  } catch {
    // OG function unreachable — fall through to normal SPA serving.
  }
}

export const config = {
  matcher: [
    '/game/:path*',
    '/review/:path*',
    '/reviews/:path*',
    '/user/:path*',
    '/list/:path*',
  ],
}
