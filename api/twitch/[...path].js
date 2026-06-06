// Serverless proxy for Twitch OAuth. Replicates the Vite dev-server proxy
// (vite.config.js) so token requests work from any device, not just localhost.
// Forwards /api/twitch/<path> -> https://id.twitch.tv/<path>.

export const config = { api: { bodyParser: false } }

async function readRawBody(req) {
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  return Buffer.concat(chunks)
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept')

  if (req.method === 'OPTIONS') {
    res.status(204).end()
    return
  }

  const parts = Array.isArray(req.query.path)
    ? req.query.path
    : [req.query.path].filter(Boolean)
  const targetUrl = `https://id.twitch.tv/${parts.join('/')}`

  const headers = {}
  if (req.headers['content-type']) headers['Content-Type'] = req.headers['content-type']
  headers['Accept'] = req.headers['accept'] || 'application/json'

  try {
    const body = req.method === 'POST' ? await readRawBody(req) : undefined
    const upstream = await fetch(targetUrl, { method: req.method, headers, body })
    const text = await upstream.text()

    res.status(upstream.status)
    res.setHeader('Content-Type', upstream.headers.get('content-type') || 'application/json')
    res.send(text)
  } catch (err) {
    res.status(502).json({ error: 'Twitch proxy error', detail: String(err) })
  }
}
