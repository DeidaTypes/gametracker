// Serverless proxy for IGDB. Replicates the Vite dev-server proxy
// (vite.config.js) so the app works from any device, not just localhost.
// Forwards /api/igdb/<path> -> https://api.igdb.com/<path>, passing through
// the Client-ID and Authorization headers the client attaches.

export const config = { api: { bodyParser: false } }

async function readRawBody(req) {
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  return Buffer.concat(chunks)
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Client-ID, Authorization, Accept')

  if (req.method === 'OPTIONS') {
    res.status(204).end()
    return
  }

  const parts = Array.isArray(req.query.path)
    ? req.query.path
    : [req.query.path].filter(Boolean)
  const targetUrl = `https://api.igdb.com/${parts.join('/')}`

  const headers = {}
  if (req.headers['client-id']) headers['Client-ID'] = req.headers['client-id']
  if (req.headers['authorization']) headers['Authorization'] = req.headers['authorization']
  headers['Accept'] = req.headers['accept'] || 'application/json'

  try {
    const body = req.method === 'POST' ? await readRawBody(req) : undefined
    const upstream = await fetch(targetUrl, { method: req.method, headers, body })
    const text = await upstream.text()

    res.status(upstream.status)
    res.setHeader('Content-Type', upstream.headers.get('content-type') || 'application/json')
    res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=86400')
    res.send(text)
  } catch (err) {
    res.status(502).json({ error: 'IGDB proxy error', detail: String(err) })
  }
}
